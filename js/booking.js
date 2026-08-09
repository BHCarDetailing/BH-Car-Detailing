/* ============================================================
   BH Car Detailing — booking flow, native to the page.

   Replaces the iframe that used to embed the CRM's /book page.
   Same server, same endpoints, same server-side pricing — but
   part of the document, so it inherits the page's fonts, scroll
   and width instead of guessing at its own height.

   Spine: the price is a destination, not a listing. Vehicle,
   coverage and depth are answered with no money on screen, then
   the customer opens their price deliberately.

   Prices come from the services table via /api/book/catalog and
   are re-computed server-side on submit — nothing here is
   trusted, and nothing is hardcoded.
   ============================================================ */
(function () {
  "use strict";

  var API = "https://bh-crm.bhdev.workers.dev";
  var root = document.querySelector("[data-bookflow]");
  if (!root) return;

  /* The three choices customers see, mapped onto the server's ten types. */
  var VEHICLES = [
    { type: "sedan", t: "Car", d: "Sedan, coupe, convertible" },
    { type: "mid_suv", t: "SUV or Truck", d: "Also vans and three-row" },
    { type: "exotic", t: "Luxury or Exotic", d: "Porsche, Ferrari, Range Rover" }
  ];
  var COVERAGE = [
    { id: "interior", t: "Interior", d: "Inside only" },
    { id: "exterior", t: "Exterior", d: "Outside only" },
    { id: "both", t: "The whole car", d: "Inside and out, priced together" },
    { id: "specialty", t: "Specialty work", d: "Correction, ceramic, curb rash and more" }
  ];
  var DEPTH_ORDER = ["maintenance", "light", "full"];
  var DEPTH_COPY = {
    maintenance: { t: "Maintenance", d: "Upkeep between details" },
    light: { t: "Light", d: "A proper refresh" },
    full: { t: "Full", d: "The deep one, nothing skipped" }
  };

  /* Lifted verbatim from the package table further up this page. Marketing
     copy, not catalog data: editing a service in Settings changes its name and
     price here, not these lines. Columns are [maintenance, light, full]. */
  var FEATURES = {
    exterior: [
      ["Foam bath & hand wash", 1, 1, 1],
      ["Spray sealant / drying aid", 1, 1, 1],
      ["Tires & rims cleaned + dressed", 0, 1, 1],
      ["Door jambs & gas cap cleaned", 0, 1, 1],
      ["Exterior glass streak-free finish", 0, 1, 1],
      ["Wheel wells cleaned", 0, 0, 1],
      ["Wax & ceramic seal (3 months)", 0, 0, 1],
      ["Clay bar decontamination", 0, 0, 1]
    ],
    interior: [
      ["Two-stage vacuum", 1, 1, 1],
      ["Floor mats cleaned", 1, 1, 1],
      ["Full air purge blow-out", 0, 1, 1],
      ["Plastic, vinyl & leather wiped down", 0, 1, 1],
      ["Interior glass streak-free finish", 0, 1, 1],
      ["Cloth seats shampooed & extracted", 0, 0, 1],
      ["Leather scrubbed & conditioned", 0, 0, 1]
    ]
  };
  var TIER_IX = { maintenance: 1, light: 2, full: 3 };

  /* Headlight restoration is priced per headlight and is the only line on the
     menu with a quantity. The catalog has no per-unit flag, so it is spotted by
     name — renaming that service in Settings drops the counter back to one. */
  var PER_UNIT = /headlight/i;
  var PER_UNIT_MAX = 2;

  var STEPS = ["vehicle", "coverage", "depth", "price", "addons", "when", "who", "done"];

  var s = {
    step: "vehicle", vehicle: "", coverage: "", depth: "", specialtyId: "",
    chosenId: "", addons: {}, opened: false,
    date: today(), slots: [], slotsLoading: false, slot: "",
    fullName: "", phone: "", email: "", address: "", notes: "",
    consent: false, website: "", mountedAt: Date.now(),
    submitting: false, err: "", result: null
  };
  var catalog = null, loadFailed = false, leadTimer = null, leadSent = false;

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function money(c) { return "$" + Math.round(c / 100); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function bucket() {
    if (!catalog) return "other";
    for (var i = 0; i < catalog.vehicle_types.length; i++) {
      if (catalog.vehicle_types[i].value === s.vehicle) return catalog.vehicle_types[i].bucket;
    }
    return "other";
  }
  /* Mirrors the server: explicit size price, else the base price. */
  function priceFor(svc) {
    var p = svc.size_pricing && svc.size_pricing[bucket()];
    return isFinite(p) && p > 0 ? Math.round(p) : Math.max(0, Math.round(svc.base_price_cents));
  }

  function primaries() {
    if (!catalog) return [];
    return catalog.services.filter(function (x) {
      return x.standalone && !x.is_addon &&
        (priceFor(x) > 0 || x.requires_planning || x.level === "specialty");
    });
  }
  function specialties() {
    return primaries().filter(function (x) { return x.level === "specialty" || x.area === "specialty"; });
  }
  function depthsAvailable() {
    var seen = {};
    primaries().forEach(function (x) { if (x.area === s.coverage) seen[x.level] = 1; });
    return DEPTH_ORDER.filter(function (l) { return seen[l]; });
  }
  /* Every service filed at this area+level, not just the first. Two services can
     share a slot, and returning one of them silently makes the other unsellable. */
  function servicesAt(level) {
    return primaries().filter(function (x) { return x.area === s.coverage && x.level === level; });
  }
  function serviceAt(level) { return servicesAt(level)[0] || null; }
  function addonOptions() {
    if (!catalog) return [];
    return catalog.services.filter(function (x) { return x.is_addon && priceFor(x) > 0; });
  }
  function chosenService() {
    if (s.coverage === "specialty") {
      var sp = specialties();
      for (var i = 0; i < sp.length; i++) if (sp[i].id === s.specialtyId) return sp[i];
      return null;
    }
    var here = servicesAt(s.depth);
    if (s.chosenId) {
      var all = primaries();
      for (var i = 0; i < all.length; i++) if (all[i].id === s.chosenId) return all[i];
    }
    return here[0] || null;
  }
  /* Cards are built from services, not levels. Everything filed at the chosen
     level appears — two services can share a slot and neither may be hidden —
     followed by the rung above when there is one. At the top the card stands
     alone: never offer a cheaper option beside what they already chose. */
  function cardList() {
    if (s.coverage === "specialty") return [];
    var d = depthsAvailable(), i = d.indexOf(s.depth);
    if (i < 0) return [];
    var out = servicesAt(s.depth).map(function (svc) { return { svc: svc, mine: true }; });
    if (i < d.length - 1) {
      var up = servicesAt(d[i + 1])[0];
      if (up) out.push({ svc: up, mine: false, diff: priceFor(up) - priceFor(out[0].svc) });
    }
    return out;
  }
  function addonTotal() {
    var t = 0, opts = addonOptions();
    Object.keys(s.addons).forEach(function (id) {
      for (var i = 0; i < opts.length; i++) if (opts[i].id === id) t += priceFor(opts[i]) * s.addons[id];
    });
    return t;
  }
  function totals() {
    var svc = chosenService();
    var base = svc ? priceFor(svc) : 0;
    var quoteOnly = !!svc && base <= 0;
    return { total: (quoteOnly ? 0 : base) + addonTotal(), quoteOnly: quoteOnly, needsPlanning: !!(svc && svc.requires_planning) };
  }

  /* ---------- rendering ---------- */

  function optionRow(t, d, pressed, attrs) {
    return '<button type="button" class="bf-opt" aria-pressed="' + (pressed ? "true" : "false") + '" ' + attrs + '>' +
      '<span class="bf-opt-txt"><span class="bf-opt-t">' + esc(t) + '</span>' +
      (d ? '<span class="bf-opt-d">' + esc(d) + "</span>" : "") + "</span>" +
      '<span class="bf-opt-go" aria-hidden="true">&rsaquo;</span></button>';
  }

  function featureList(cov, level, vsLevel) {
    var groups = cov === "both" ? ["exterior", "interior"] : [cov];
    var ix = TIER_IX[level] || 1, prev = vsLevel ? TIER_IX[vsLevel] || 0 : 0;
    var html = '<div class="bf-inc">';
    groups.forEach(function (g) {
      var rows = FEATURES[g].filter(function (r) { return r[ix]; });
      html += '<div class="bf-inc-g"><b>' + esc(g) + "</b><ul>";
      rows.forEach(function (r) {
        html += "<li" + (prev && !r[prev] ? ' class="bf-new"' : "") + ">" + esc(r[0]) + "</li>";
      });
      html += "</ul></div>";
    });
    return html + "</div>";
  }

  function renderCards() {
    var html = "";
    if (s.coverage === "specialty") {
      var sp = chosenService();
      if (!sp) return "";
      var p = priceFor(sp);
      html += '<div class="bf-card" data-sel="1">' +
        '<span class="bf-tag bf-you">Your pick</span>' +
        '<div class="bf-card-top"><h4>' + esc(sp.name) + "</h4>" +
        '<span class="bf-amt' + (p <= 0 ? " bf-q" : "") + '">' + (p > 0 ? money(p) : "We'll quote it") + "</span></div>" +
        (sp.description ? '<p class="bf-only">' + esc(sp.description) + "</p>" : "") + "</div>";
      return html;
    }
    var cards = cardList(), current = chosenService();
    cards.forEach(function (c) {
      var svc = c.svc, sel = current && current.id === svc.id;
      // Two services can sit at the same level. The selected one is the pick;
      // any sibling is an alternative, not a downgrade.
      var tag = !c.mine ? "Step up" : sel ? "Your pick" : "Also at this level";
      html += '<button type="button" class="bf-card" data-sel="' + (sel ? "1" : "0") +
        '" data-pick-service="' + esc(svc.id) + '">' +
        '<span class="bf-tag ' + (sel ? "bf-you" : "bf-up") + '">' + tag + "</span>" +
        '<div class="bf-card-top"><h4>' + esc(svc.name) + "</h4>" +
        '<span><span class="bf-amt">' + money(priceFor(svc)) + "</span>" +
        (c.diff > 0 ? '<span class="bf-delta">+' + money(c.diff) + " more</span>" : "") + "</span></div>" +
        featureList(s.coverage, svc.level, c.mine ? "" : s.depth) + "</button>";
    });
    return html;
  }

  function stepBody() {
    var t = totals(), svc = chosenService(), i;

    if (loadFailed) {
      return '<h3 class="bf-ask">We can\'t load pricing <em>right now.</em></h3>' +
        '<p class="bf-hint">Call or text us on <a href="tel:+19177831038">(917) 783-1038</a> and we\'ll quote you directly.</p>';
    }
    if (!catalog) return '<p class="bf-hint">Loading the menu…</p>';

    switch (s.step) {
      case "vehicle":
        return '<h3 class="bf-ask">What are we <em>detailing?</em></h3>' +
          '<p class="bf-hint">Size and finish change what the job takes, so this sets your price.</p>' +
          '<div class="bf-opts">' + VEHICLES.map(function (v) {
            return optionRow(v.t, v.d, s.vehicle === v.type, 'data-vehicle="' + esc(v.type) + '"');
          }).join("") + "</div>";

      case "coverage":
        return '<h3 class="bf-ask">What needs the <em>work?</em></h3>' +
          '<p class="bf-hint">Inside, outside, or the whole car.</p>' +
          '<div class="bf-opts">' + COVERAGE.map(function (c) {
            return optionRow(c.t, c.d, s.coverage === c.id, 'data-coverage="' + esc(c.id) + '"');
          }).join("") + "</div>";

      case "depth":
        if (s.coverage === "specialty") {
          return '<h3 class="bf-ask">Which <em>specialty?</em></h3>' +
            '<p class="bf-hint">Some of these we price on sight rather than off a menu.</p>' +
            '<div class="bf-opts">' + specialties().map(function (x) {
              return optionRow(x.name, x.description || "", s.specialtyId === x.id, 'data-specialty="' + esc(x.id) + '"');
            }).join("") + "</div>";
        }
        return '<h3 class="bf-ask">How far do we <em>take it?</em></h3>' +
          '<p class="bf-hint">Pick the level of work. You\'ll see your price next.</p>' +
          '<div class="bf-opts">' + depthsAvailable().map(function (l) {
            return optionRow(DEPTH_COPY[l].t, DEPTH_COPY[l].d, s.depth === l, 'data-depth="' + esc(l) + '"');
          }).join("") + "</div>";

      case "price":
        if (!svc) return "";
        return '<h3 class="bf-ask">Your price is <em>ready.</em></h3>' +
          '<p class="bf-hint">Open it to see what your detail costs, and what it includes.</p>' +
          '<div class="bf-vault' + (s.opened ? " bf-open" : "") + '">' +
          '<span class="bf-sheen' + (s.opened ? " bf-go" : "") + '" aria-hidden="true"></span>' +
          '<div class="bf-cover' + (s.opened ? " bf-off" : "") + '">' +
          '<span class="bf-lead">Quoted for</span>' +
          '<span class="bf-what">' + esc(svc.name) + "</span>" +
          '<button type="button" class="bf-reveal" data-reveal>Show my price</button></div>' +
          '<div class="bf-cards"' + (s.opened ? "" : ' inert aria-hidden="true"') + ">" + renderCards() + "</div></div>";

      case "addons":
        var opts = addonOptions();
        return '<h3 class="bf-ask">Anything <em>else?</em></h3>' +
          '<p class="bf-hint">Optional. Skip straight past if you don\'t need any.</p>' +
          (opts.length === 0 ? '<p class="bf-hint">Nothing else priced for this vehicle right now.</p>' :
            '<div class="bf-opts">' + opts.map(function (a) {
              var on = !!s.addons[a.id], per = PER_UNIT.test(a.name);
              return '<div class="bf-add" data-add="' + esc(a.id) + '" data-on="' + (on ? "1" : "0") +
                '" role="button" tabindex="0">' +
                '<span class="bf-box" aria-hidden="true">✓</span>' +
                '<span class="bf-add-nm">' + esc(a.name) + "</span>" +
                '<span class="bf-add-pr">+' + money(priceFor(a)) + (per ? " ea" : "") + "</span>" +
                (per && on ? '<span class="bf-qty"><button type="button" data-qty="-1" aria-label="One fewer headlight">−</button>' +
                  "<span>" + s.addons[a.id] + '</span><button type="button" data-qty="1" aria-label="One more headlight">+</button></span>' : "") +
                "</div>";
            }).join("") + "</div>");

      case "when":
        if (t.needsPlanning) {
          return '<h3 class="bf-ask">We\'ll call to <em>book this in.</em></h3>' +
            '<p class="bf-hint">This one needs a look before we lock a date. Add your details next and we\'ll confirm scheduling and the final price on the phone.</p>';
        }
        var slotHtml = s.slotsLoading ? '<p class="bf-hint">Loading times…</p>'
          : s.slots.length === 0 ? '<p class="bf-hint">Nothing open that day. Try another date.</p>'
            : s.slots.map(function (iso) {
              var when = new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
              return '<button type="button" class="bf-slot" aria-pressed="' + (s.slot === iso ? "true" : "false") +
                '" data-slot="' + esc(iso) + '">' + esc(when) + "</button>";
            }).join("");
        return '<h3 class="bf-ask">When suits <em>you?</em></h3>' +
          '<p class="bf-hint">Two-hour arrival windows. We come to you.</p>' +
          '<input class="bf-date" type="date" min="' + today() + '" value="' + esc(s.date) + '" data-date aria-label="Date" />' +
          '<div class="bf-slots">' + slotHtml + "</div>";

      case "who":
        return '<h3 class="bf-ask">Where do we <em>find you?</em></h3>' +
          '<p class="bf-hint">We confirm by text before we set off.</p>' +
          '<div class="bf-fields">' +
          '<input type="text" data-f="fullName" placeholder="Full name" autocomplete="name" value="' + esc(s.fullName) + '" />' +
          '<input type="tel" inputmode="tel" data-f="phone" placeholder="Phone" autocomplete="tel" value="' + esc(s.phone) + '" />' +
          '<input type="email" inputmode="email" data-f="email" placeholder="Email (optional)" autocomplete="email" value="' + esc(s.email) + '" />' +
          '<input type="text" data-f="address" placeholder="Address" autocomplete="street-address" value="' + esc(s.address) + '" />' +
          '<textarea rows="2" data-f="notes" placeholder="Notes — pet hair, problem spots, gate code">' + esc(s.notes) + "</textarea>" +
          "</div>" +
          '<input class="bf-hp" data-f="website" tabindex="-1" autocomplete="off" aria-hidden="true" value="' + esc(s.website) + '" />' +
          '<label class="bf-consent"><input type="checkbox" data-consent' + (s.consent ? " checked" : "") + " />" +
          "<span>Yes, text me about my quote and appointment updates from BH Car Detailing. Msg &amp; data rates may apply. " +
          "Msg frequency varies. Reply STOP to opt out anytime. " +
          '<a href="/terms.html">Terms</a> &middot; <a href="/privacy-policy.html">Privacy</a></span></label>' +
          '<p class="bf-fine">A travel fee applies more than 15 miles out, confirmed before we arrive. Heavily soiled vehicles may be adjusted at booking.</p>' +
          (s.err ? '<p class="bf-err">' + esc(s.err) + "</p>" : "");

      case "done":
        var r = s.result || {};
        return '<div class="bf-done"><div class="bf-mark" aria-hidden="true">✓</div>' +
          '<h3 class="bf-ask">' + (r.status === "scheduled" ? "You're <em>booked in.</em>" : "Got it — <em>we'll call.</em>") + "</h3>" +
          "<p>" + (r.status === "scheduled" && s.slot
            ? esc(svc ? svc.name : "Your detail") + " on " +
              esc(new Date(s.slot).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })) +
              ". We'll text you to confirm."
            : "We'll call shortly to confirm scheduling and the final price.") + "</p>" +
          (r.job_id ? '<p class="bf-ref">Reference ' + esc(r.job_id.slice(0, 8).toUpperCase()) + "</p>" : "") +
          "</div>";
    }
    return "";
  }

  function footer() {
    if (s.step === "done" || loadFailed || !catalog) return "";
    var t = totals(), svc = chosenService();
    var showMoney = s.opened && STEPS.indexOf(s.step) >= STEPS.indexOf("price");
    var showBack = s.step !== "vehicle";
    var cta = "";
    if (s.step === "who") {
      cta = '<button type="button" class="bf-cta" data-submit' + (s.submitting ? " disabled" : "") + ">" +
        (s.submitting ? "Sending…" : (t.quoteOnly || t.needsPlanning) ? "Request my quote" : "Confirm booking") + "</button>";
    } else if (s.step === "price" || s.step === "addons" || s.step === "when") {
      var can = (s.step === "price" && s.opened) || s.step === "addons" ||
        (s.step === "when" && (t.needsPlanning || s.slot));
      cta = '<button type="button" class="bf-cta" data-next' + (can ? "" : " disabled") + ">" +
        (s.step === "price" ? "Looks good" : s.step === "addons"
          ? (Object.keys(s.addons).length ? "Continue" : "No thanks") : "Continue") + "</button>";
    }
    if (!showBack && !cta && !showMoney) return "";
    return '<div class="bf-bar">' +
      (showBack ? '<button type="button" class="bf-back" data-back>Back</button>' : "") +
      (showMoney && svc ? '<div class="bf-lbl"><b>' + esc(svc.name) + "</b><small>" +
        esc((VEHICLES.filter(function (v) { return v.type === s.vehicle; })[0] || {}).t || "") +
        (Object.keys(s.addons).length ? " · " + Object.keys(s.addons).length + " add-on" + (Object.keys(s.addons).length > 1 ? "s" : "") : "") +
        "</small></div>" +
        '<div class="bf-tot">' + (t.quoteOnly ? (addonTotal() ? money(addonTotal()) + " + quote" : "Quote") : money(t.total)) + "</div>" : "") +
      cta + "</div>";
  }

  function crumbs() {
    if (s.step === "done" || !catalog) return "";
    var items = [];
    if (s.vehicle) items.push([(VEHICLES.filter(function (v) { return v.type === s.vehicle; })[0] || {}).t, "vehicle"]);
    if (s.coverage) items.push([(COVERAGE.filter(function (c) { return c.id === s.coverage; })[0] || {}).t, "coverage"]);
    if (s.coverage !== "specialty" && s.depth) items.push([DEPTH_COPY[s.depth].t, "depth"]);
    if (s.specialtyId) { var sp = chosenService(); if (sp) items.push([sp.name, "depth"]); }
    return items.map(function (it) {
      return '<button type="button" class="bf-crumb" data-goto="' + esc(it[1]) + '">' + esc(it[0]) + "</button>";
    }).join("");
  }

  function render() {
    var ix = STEPS.indexOf(s.step);
    var rail = s.step === "done" || !catalog ? "" : '<div class="bf-rail">' +
      STEPS.slice(0, 7).map(function (_, i) { return '<i class="' + (i <= ix ? "bf-on" : "") + '"></i>'; }).join("") + "</div>";
    root.innerHTML = '<div class="bf-panel">' + rail +
      '<div class="bf-crumbs">' + crumbs() + "</div>" +
      '<div class="bf-step">' + stepBody() + "</div>" + footer() + "</div>";
  }

  /* ---------- behaviour ---------- */

  function go(step) { s.step = step; s.err = ""; render(); }

  function loadSlots() {
    s.slotsLoading = true; s.slots = []; s.slot = ""; render();
    fetch(API + "/api/book/availability?date=" + encodeURIComponent(s.date))
      .then(function (r) { return r.json(); })
      .then(function (r) { s.slots = (r && r.slots) || []; })
      .catch(function () { s.slots = []; })
      .finally(function () { s.slotsLoading = false; render(); });
  }

  /* A drop-off is still a lead worth calling. Sent once name and phone are
     both there; sets no consent, so it is callable, never textable. */
  function queueLead() {
    if (leadSent) return;
    clearTimeout(leadTimer);
    leadTimer = setTimeout(function () {
      if (!s.fullName.trim() || !s.phone.trim() || leadSent) return;
      leadSent = true;
      fetch(API + "/api/book/lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.fullName.trim(), phone: s.phone, email: s.email, website: s.website })
      }).catch(function () {});
    }, 1200);
  }

  function submit() {
    var t = totals(), svc = chosenService();
    if (!s.consent) { s.err = "Please tick the box so we can text you about your booking."; return render(); }
    if (!s.phone.trim()) { s.err = "Add a phone number so we can confirm."; return render(); }
    if (!t.needsPlanning && !s.slot) { s.err = "Pick a time first."; return render(); }
    if (!svc) { s.err = "Choose a service first."; return render(); }

    s.submitting = true; s.err = ""; render();
    var parts = s.fullName.trim().split(/\s+/);
    var lines = [{ service_id: svc.id, qty: 1 }];
    Object.keys(s.addons).forEach(function (id) { lines.push({ service_id: id, qty: s.addons[id] }); });

    fetch(API + "/api/book/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_type: s.vehicle, lines: lines,
        scheduled_start: t.needsPlanning ? null : s.slot,
        // The server stores first and last separately; a single-word name keeps
        // an empty surname rather than guessing at one.
        first_name: parts[0] || "", last_name: parts.slice(1).join(" "),
        phone: s.phone, email: s.email, address: s.address, notes: s.notes,
        sms_opt_in: s.consent, website: s.website, ts: s.mountedAt
      })
    })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (b) { return { r: r, b: b }; }); })
      .then(function (o) {
        if (o.r.status === 409) { s.err = "That time was just taken. Pick another."; s.submitting = false; return go("when"); }
        if (!o.r.ok || !o.b || !o.b.ok) {
          s.err = o.b && o.b.error === "consent_required"
            ? "Please tick the consent box to continue."
            : "That didn't go through. Try again, or call us on (917) 783-1038.";
          s.submitting = false; return render();
        }
        s.result = o.b; s.submitting = false; go("done");
      })
      .catch(function () {
        s.err = "That didn't go through. Try again, or call us on (917) 783-1038.";
        s.submitting = false; render();
      });
  }

  root.addEventListener("click", function (e) {
    var el;
    if ((el = e.target.closest("[data-vehicle]"))) {
      s.vehicle = el.getAttribute("data-vehicle"); s.opened = false; return go("coverage");
    }
    if ((el = e.target.closest("[data-coverage]"))) {
      s.coverage = el.getAttribute("data-coverage");
      s.depth = ""; s.chosenId = ""; s.specialtyId = ""; s.opened = false;
      return go("depth");
    }
    if ((el = e.target.closest("[data-depth]"))) {
      s.depth = el.getAttribute("data-depth"); s.chosenId = ""; s.opened = false;
      return go("price");
    }
    if ((el = e.target.closest("[data-specialty]"))) {
      s.specialtyId = el.getAttribute("data-specialty"); s.opened = false;
      return go("price");
    }
    if (e.target.closest("[data-reveal]")) { s.opened = true; return render(); }
    if ((el = e.target.closest("[data-pick-service]"))) {
      s.chosenId = el.getAttribute("data-pick-service"); return render();
    }
    if ((el = e.target.closest("[data-qty]"))) {
      e.stopPropagation();
      var row = el.closest("[data-add]"), id = row.getAttribute("data-add");
      var v = (s.addons[id] || 1) + Number(el.getAttribute("data-qty"));
      s.addons[id] = Math.min(PER_UNIT_MAX, Math.max(1, v));
      return render();
    }
    if ((el = e.target.closest("[data-add]"))) {
      var aid = el.getAttribute("data-add");
      if (s.addons[aid]) delete s.addons[aid]; else s.addons[aid] = 1;
      return render();
    }
    if ((el = e.target.closest("[data-slot]"))) { s.slot = el.getAttribute("data-slot"); return render(); }
    if ((el = e.target.closest("[data-goto]"))) { return go(el.getAttribute("data-goto")); }
    if (e.target.closest("[data-back]")) {
      var order = STEPS.slice(0, 7), i = order.indexOf(s.step);
      return go(order[Math.max(0, i - 1)]);
    }
    if (e.target.closest("[data-next]")) {
      var nxt = s.step === "price" ? "addons" : s.step === "addons" ? "when" : "who";
      go(nxt);
      if (nxt === "when" && !totals().needsPlanning) loadSlots();
      return;
    }
    if (e.target.closest("[data-submit]")) return submit();
  });

  root.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-add]")) {
      e.preventDefault(); e.target.closest("[data-add]").click();
    }
  });

  /* Inputs are read straight off the DOM so a re-render never wipes what the
     customer is mid-way through typing. */
  root.addEventListener("input", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (f) { s[f] = e.target.value; if (f === "fullName" || f === "phone" || f === "email") queueLead(); return; }
    if (e.target.hasAttribute("data-date")) { s.date = e.target.value; return loadSlots(); }
  });
  root.addEventListener("change", function (e) {
    if (e.target.hasAttribute("data-consent")) { s.consent = e.target.checked; }
  });

  render();
  fetch(API + "/api/book/catalog")
    .then(function (r) { if (!r.ok) throw new Error("catalog"); return r.json(); })
    .then(function (c) { catalog = c; render(); })
    .catch(function () { loadFailed = true; render(); });
})();

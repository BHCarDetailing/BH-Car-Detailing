/* ============================================================
   BH CAR DETAILING — Interactions
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Nav: transparent → solid on scroll ---------- */
  const nav = document.querySelector(".nav");
  const onScroll = () => nav && nav.classList.toggle("scrolled", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Mobile menu ---------- */
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      document.body.style.overflow = open ? "hidden" : "";
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.classList.remove("open");
        document.body.style.overflow = "";
      })
    );
  }

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---------- Hero: zoom + fade as user scrolls (desktop only — on mobile,
     focusing a form field auto-scrolls the page to clear the keyboard, which
     would otherwise fade/translate the hero content away mid-typing) ---------- */
  const heroMedia = document.querySelector(".hero-media");
  const heroContent = document.querySelector(".hero-content");
  if (
    heroMedia &&
    heroContent &&
    matchMedia("(min-width: 861px)").matches &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = window.scrollY;
          const h = window.innerHeight;
          if (y < h) {
            const p = y / h;
            heroMedia.style.transform = "scale(" + (1 + p * 0.18) + ")";
            heroContent.style.opacity = String(1 - p * 1.4);
            heroContent.style.transform = "translateY(" + y * -0.25 + "px)";
          }
          ticking = false;
        });
      },
      { passive: true }
    );
    heroMedia.style.animation = "none"; /* scroll drives the zoom instead */
  }

  /* ---------- Animated counters ---------- */
  const counters = document.querySelectorAll("[data-count]");
  if (counters.length) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          const end = parseFloat(el.dataset.count);
          const suffix = el.dataset.suffix || "";
          const dur = 1600;
          const start = performance.now();
          const tick = (now) => {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 4);
            el.textContent = Math.round(end * eased) + suffix;
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          cio.unobserve(el);
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((c) => cio.observe(c));
  }

  /* ---------- Before / After slider ---------- */
  document.querySelectorAll(".ba").forEach((ba) => {
    const set = (clientX) => {
      const r = ba.getBoundingClientRect();
      const pos = Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100));
      ba.style.setProperty("--pos", pos + "%");
    };
    let dragging = false;
    ba.addEventListener("pointerdown", (e) => {
      dragging = true;
      ba.setPointerCapture(e.pointerId);
      set(e.clientX);
    });
    ba.addEventListener("pointermove", (e) => dragging && set(e.clientX));
    ba.addEventListener("pointerup", () => (dragging = false));
    ba.addEventListener("pointercancel", () => (dragging = false));
  });

  /* ---------- Testimonial carousel: manual drag ---------- */
  document.querySelectorAll(".t-track").forEach((track) => {
    let dragging = false;
    let startX = 0;
    let startOffset = 0;
    let offset = 0;

    track.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX;
      startOffset = offset;
      track.classList.add("dragging");
      track.style.userSelect = "none";
      track.setPointerCapture(e.pointerId);
    });
    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      offset = startOffset + (e.clientX - startX);
      track.style.translate = offset + "px";
    });
    const stopDrag = () => {
      dragging = false;
      track.classList.remove("dragging");
      track.style.userSelect = "";
    };
    track.addEventListener("pointerup", stopDrag);
    track.addEventListener("pointercancel", stopDrag);
  });

  /* ---------- Lightbox ---------- */
  const lb = document.querySelector(".lightbox");
  if (lb) {
    const lbImg = lb.querySelector("img");
    document.querySelectorAll(".g-item img, .ig-item img").forEach((img) => {
      img.closest(".g-item, .ig-item").addEventListener("click", (e) => {
        const parent = img.closest("a");
        if (parent && parent.href && img.closest(".ig-item")) return; /* IG tiles link out */
        e.preventDefault();
        lbImg.src = img.dataset.full || img.src;
        lb.classList.add("open");
        document.body.style.overflow = "hidden";
      });
    });
    const close = () => {
      lb.classList.remove("open");
      document.body.style.overflow = "";
    };
    lb.querySelector(".lightbox-close").addEventListener("click", close);
    lb.addEventListener("click", (e) => e.target === lb && close());
    document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  }

  /* ---------- Promo modal: 10% off first detail ---------- */
  const modal = document.getElementById("promo-modal");
  if (modal) {
    const KEY = "bh-promo-dismissed";
    const openModal = () => {
      modal.classList.add("open");
      document.body.style.overflow = "hidden";
    };
    const closeModal = () => {
      modal.classList.remove("open");
      document.body.style.overflow = "";
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    };
    let dismissed = null;
    try { dismissed = localStorage.getItem(KEY); } catch (e) {}
    /* show again after 7 days */
    if (!dismissed || Date.now() - Number(dismissed) > 7 * 864e5) {
      setTimeout(openModal, 1800);
    }
    modal.querySelector(".modal-close").addEventListener("click", closeModal);
    modal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => e.key === "Escape" && modal.classList.contains("open") && closeModal());
    /* any "claim offer" trigger elsewhere on the page */
    document.querySelectorAll("[data-open-promo]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openModal();
      })
    );
    modal.querySelector("form").addEventListener("submit", () => {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    });
  }

  /* ---------- "The Best Option For You" recommender ---------- */
  const quiz = document.getElementById("quiz");
  if (quiz) {
    const PACKAGES = {
      washExt: { name: "Exterior Car Wash", desc: "A meticulous hand wash & dry to keep your paint clean between details." },
      washFull: { name: "Full Car Wash", desc: "Hand wash & dry outside, light vacuum and clean windows inside. The perfect reset." },
      light: { name: "Light Detail", desc: "Full interior scrub — jambs, sills, crevices, fabric & carpet — plus hand wash, wheels and a 3-month spray sealant." },
      full: { name: "Full Detail", desc: "Our complete restoration detail: deep carpet & fabric extraction, scuff removal, wheel wells, 3-month wax + 6-month paint sealant." },
      correction: { name: "Paint Correction", desc: "Single-stage machine polish that removes swirl marks, light scratches and defects — restoring true clarity and gloss." },
      ceramic: { name: "Ceramic Coating", desc: "Clay bar decontamination + professional-grade ceramic. Hydrophobic, UV-resistant protection that lasts 1–2 years." },
      maintenance: { name: "Maintenance Plan", desc: "A recurring plan tailored to your vehicle and schedule, so it never falls out of showroom condition." },
    };

    const QUESTIONS = [
      {
        q: "What does your vehicle need most right now?",
        options: [
          { label: "A clean — it just needs a proper wash", value: "wash" },
          { label: "A full refresh, inside and out", value: "detail" },
          { label: "Fix swirls, scratches & dull paint", value: "paint" },
          { label: "Long-term protection & gloss", value: "protect" },
        ],
      },
      {
        q: "How is the interior looking?",
        options: [
          { label: "Pretty clean — light dust at most", value: "light" },
          { label: "Lived-in — needs a real scrub", value: "medium" },
          { label: "Rough — stains, odors, heavy buildup", value: "heavy" },
        ],
      },
      {
        q: "How often do you want it maintained?",
        options: [
          { label: "Just this once for now", value: "once" },
          { label: "I want it kept perfect on a schedule", value: "recurring" },
        ],
      },
    ];

    const answers = [];
    const stepEl = quiz.querySelector(".quiz-step");
    const resultEl = quiz.querySelector(".quiz-result");
    const progress = quiz.querySelectorAll(".quiz-progress i");

    function pick() {
      const [need, interior, cadence] = answers;
      if (cadence === "recurring") return "maintenance";
      if (need === "paint") return "correction";
      if (need === "protect") return "ceramic";
      if (need === "detail") return interior === "light" ? "light" : "full";
      /* wash */
      if (interior === "heavy") return "full";
      if (interior === "medium") return "light";
      return "washFull";
    }

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const swap = (el, update) => {
      if (reduceMotion) return update();
      el.classList.add("fade-out");
      setTimeout(() => {
        update();
        el.classList.remove("fade-out");
      }, 220);
    };

    function render(i) {
      swap(stepEl, () => {
        progress.forEach((p, idx) => p.classList.toggle("on", idx <= i));
        const q = QUESTIONS[i];
        stepEl.innerHTML =
          "<h3>" + q.q + "</h3><div class='quiz-options'>" +
          q.options.map((o) => "<button type='button' data-v='" + o.value + "'>" + o.label + "</button>").join("") +
          "</div>";
        stepEl.querySelectorAll("button").forEach((b) =>
          b.addEventListener("click", () => {
            answers[i] = b.dataset.v;
            if (i + 1 < QUESTIONS.length) render(i + 1);
            else showResult();
          })
        );
      });
    }

    function showResult() {
      swap(stepEl, () => {
        const p = PACKAGES[pick()];
        stepEl.style.display = "none";
        quiz.querySelector(".quiz-progress").style.display = "none";
        resultEl.style.display = "block";
        resultEl.classList.add("fade-out");
        resultEl.innerHTML =
          "<span class='eyebrow'>The Best Option For You</span>" +
          "<h3>" + p.name + "</h3>" +
          "<p>" + p.desc + "</p>" +
          "<div class='actions'>" +
          "<a class='btn btn-primary' href='#book'>Book This Package</a>" +
          "<a class='btn btn-ghost' href='#services'>View All Packages</a>" +
          "</div>" +
          "<button type='button' class='quiz-restart'>Start over</button>";
        resultEl.querySelector(".quiz-restart").addEventListener("click", () => {
          swap(resultEl, () => {
            answers.length = 0;
            resultEl.style.display = "none";
            stepEl.style.display = "";
            quiz.querySelector(".quiz-progress").style.display = "";
            render(0);
          });
        });
        requestAnimationFrame(() => resultEl.classList.remove("fade-out"));
      });
    }

    resultEl.style.display = "none";
    render(0);
  }

  /* ---------- Phone fields: digits only ---------- */
  document.querySelectorAll('input[type="tel"]').forEach((input) => {
    input.setAttribute("inputmode", "numeric");
    input.addEventListener("input", () => {
      const digitsOnly = input.value.replace(/\D/g, "");
      if (digitsOnly !== input.value) input.value = digitsOnly;
    });
  });

  /* ---------- Forms: AJAX submit to Formspree (no off-site redirect) ---------- */
  const CALENDLY_URL = "https://calendly.com/bhcardetails/booknow?hide_event_type_details=1&hide_gdpr_banner=1";
  let calendlyReady = null;
  function loadCalendly() {
    if (window.Calendly) return Promise.resolve();
    if (calendlyReady) return calendlyReady;
    calendlyReady = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://assets.calendly.com/assets/external/widget.css";
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = "https://assets.calendly.com/assets/external/widget.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Calendly script failed to load"));
      document.body.appendChild(script);
    });
    return calendlyReady;
  }

  /* ---------- Static Calendly widget in the #book section ----------
     Uses Calendly's own declarative embed pattern (a data-url'd
     .calendly-inline-widget element + widget.js, exactly like the code
     Calendly's UI hands out) instead of the manual initInlineWidget()
     API — widget.js auto-scans the DOM for that element on load and
     wires it up itself. We only lazy-load the script on scroll-into-view
     and show a fallback if the script itself fails to load. */
  const bookCalendly = document.getElementById("book-calendly-widget");
  if (bookCalendly) {
    const bookFallback = document.getElementById("book-calendly-fallback");
    const bcio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          bcio.unobserve(bookCalendly);
          loadCalendly().catch(() => {
            if (bookFallback) bookFallback.style.display = "flex";
          });
        });
      },
      { rootMargin: "300px 0px" }
    );
    bcio.observe(bookCalendly);
  }

  /* ---------- Per-package "Book" buttons: open a Calendly popup ----------
     Each button carries a data-calendly URL for its own event type. We open
     Calendly's popup widget on click; if the widget script can't load we fall
     back to the element's own href (a new tab to the same booking URL). */
  document.querySelectorAll("[data-calendly]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const base = el.getAttribute("data-calendly");
      if (!base) return;
      e.preventDefault();
      const url = base + (base.indexOf("?") > -1 ? "&" : "?") + "hide_gdpr_banner=1";
      const open = () => window.Calendly && window.Calendly.initPopupWidget({ url });
      if (window.Calendly) { open(); return; }
      loadCalendly()
        .then(open)
        .catch(() => window.open(base, "_blank", "noopener"));
    });
  });

  /* ---------- CRM bridge: mirror every lead into the BH CRM backend ---------- */
  var CRM_ENDPOINT = "http://localhost:8787/api/lead"; /* TODO(deploy): switch to the workers.dev URL in Task 12 */
  var PAGE_LOADED_AT = Date.now();

  function crmSource(form) {
    var path = location.pathname;
    var area = path.match(/\/areas\/([a-z-]+)\.html$/);
    if (area) return "area:" + area[1];
    if (form.closest("#promo-modal")) return "promo-popup";
    if (path.indexOf("ceramic") !== -1) return "page:ceramic-coating";
    if (path.indexOf("paint-correction") !== -1) return "page:paint-correction";
    if (path.indexOf("maintenance") !== -1) return "page:maintenance-plans";
    return "hero-quote";
  }

  function postToCrm(form) {
    try {
      var fd = new FormData(form);
      fetch(CRM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name") || "",
          phone: fd.get("phone") || "",
          email: fd.get("email") || "",
          vehicle: fd.get("vehicle") || "",
          message: fd.get("message") || "",
          source: crmSource(form),
          source_detail: location.pathname + location.search,
          ts: PAGE_LOADED_AT,
          website: "",
        }),
      }).catch(function () {});
    } catch (e) { /* never break the user-facing submit */ }
  }

  document.querySelectorAll("form.form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const btnText = btn ? btn.textContent : "";
      let msg = form.nextElementSibling;
      if (!msg || !msg.classList.contains("form-msg")) {
        msg = document.createElement("p");
        msg.className = "form-msg";
        form.insertAdjacentElement("afterend", msg);
      }
      msg.className = "form-msg";
      msg.textContent = "";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Sending…";
      }

      try {
        postToCrm(form);
        const res = await fetch(form.action, {
          method: "POST",
          body: new FormData(form),
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("Form submission failed");
        form.reset();
        msg.classList.add("success");
        msg.textContent =
          form.dataset.successMsg ||
          "Thanks — we've got your info! We'll text or call you shortly (usually within the hour) with your quote and next steps.";

        if (typeof gtag === "function") gtag("event", "generate_lead");

        const calendly = form.parentElement.querySelector(".calendly-embed");
        if (calendly && !calendly.dataset.loaded) {
          calendly.dataset.loaded = "true";
          calendly.style.display = "block";
          const widget = document.createElement("div");
          /* Not "calendly-inline-widget" — Calendly's widget.js auto-scans for that exact
             class on script load and crashes (parseOptions: null.split) when it finds one
             with no data-url, since this codebase initializes it manually instead. */
          widget.className = "calendly-inline-target";
          widget.style.minWidth = "320px";
          widget.style.height = "700px";
          calendly.appendChild(widget);
          loadCalendly().then(() => {
            window.Calendly && window.Calendly.initInlineWidget({ url: CALENDLY_URL, parentElement: widget });
          });
          calendly.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } catch (err) {
        msg.classList.add("error");
        msg.textContent = "Something went wrong sending that. Please call or text us at (917) 783-1038.";
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btnText;
        }
      }
    });
  });

  /* ---------- Footer year ---------- */
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ---------- GA4 + Google Ads: load gtag.js on first interaction (or after 5s, whichever first) ---------- */
  let gaLoaded = false;
  function loadGA() {
    if (gaLoaded) return;
    gaLoaded = true;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=G-HS0SV535XW";
    document.head.appendChild(script);
    gtag("js", new Date());
    gtag("config", "G-HS0SV535XW");
    gtag("config", "AW-18229436014");
  }
  ["scroll", "click", "keydown", "touchstart", "mousemove"].forEach((evt) =>
    window.addEventListener(evt, loadGA, { once: true, passive: true })
  );
  setTimeout(loadGA, 5000);

  /* ---------- Google Ads conversion: fire when a Calendly booking is completed ----------
     Booking happens inside the Calendly embed (#book + the post-form widget). Calendly
     posts a window message {event:"calendly.event_scheduled"} the moment an appointment is
     booked, which is our real "purchase". We listen for it and report the Google Ads
     conversion (AW-18229436014 / label Q2rjCJ686sccEO68vPRD, value $1). A guard prevents
     double-counting if Calendly fires the message more than once. */
  let bookingConversionSent = false;
  function reportBookingConversion() {
    if (bookingConversionSent) return;
    bookingConversionSent = true;
    loadGA(); // make sure gtag.js + the AW- config are loaded before we send
    if (typeof gtag === "function") {
      gtag("event", "conversion", {
        send_to: "AW-18229436014/Q2rjCJ686sccEO68vPRD",
        value: 1.0,
        currency: "USD",
      });
    }
  }
  window.addEventListener("message", function (e) {
    if (
      e &&
      e.origin === "https://calendly.com" &&
      e.data &&
      typeof e.data.event === "string" &&
      e.data.event === "calendly.event_scheduled"
    ) {
      reportBookingConversion();
    }
  });
})();

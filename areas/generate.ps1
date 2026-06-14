# Generates city landing pages from _template.html
$tpl = Get-Content -Raw -Encoding UTF8 "$PSScriptRoot\_template.html"

$cities = @(
  @{
    slug = "miami"; city = "Miami"
    h1top = "Miami Runs On"; h1accent = "Detail."
    hero = "../assets/photos/IMG_6635-1200w.jpg"
    side = "../assets/photos/IMG_0377-900w.jpg"
    hoods = "Brickell, Downtown, Wynwood, Coconut Grove, Key Biscayne, Doral and beyond"
    intro1 = "Miami has one of the densest exotic and luxury car scenes in the country, and it shows no mercy to paint. Sun, salt air and daily storms work on your clear coat every single day. BH Car Detailing was built here, for exactly this: concierge-level mobile detailing that comes to your condo garage in Brickell, your office in Downtown, or your driveway in the Grove."
    intro2 = "From a hand wash before a night out to full paint correction and ceramic coating on a new delivery, every vehicle gets the same standard of care we give Ferraris, Lamborghinis and Rolls-Royces — methodical, documented and done right where you park."
  },
  @{
    slug = "miami-beach"; city = "Miami Beach"
    h1top = "Salt Air Meets"; h1accent = "Its Match."
    hero = "../assets/photos/IMG_6515-1200w.jpg"
    side = "../assets/photos/IMG_6507-900w.jpg"
    hoods = "South Beach, Mid-Beach, North Beach, the Sunset Islands and surrounding waterfront communities"
    intro1 = "Living on the beach is the best thing you can do for yourself and the worst thing you can do for your paint. Salt spray accelerates corrosion, ocean air dulls gloss, and beach parking adds contamination most owners never see until it is etched in. BH brings the full studio to your building — condo garages, valet decks and private driveways included."
    intro2 = "We coordinate with building management and valet where needed, work cleanly in tight garage spaces, and recommend ceramic protection for every vehicle that lives within a mile of the ocean. Your car should look like it lives on Ocean Drive, not like it commutes through it."
  },
  @{
    slug = "coral-gables"; city = "Coral Gables"
    h1top = "The Gables Standard,"; h1accent = "Met."
    hero = "../assets/photos/IMG_6638-1200w.jpg"
    side = "../assets/photos/IMG_8042-900w.jpg"
    hoods = "the Gables, Cocoplum, Snapper Creek, Gables Estates and South Miami"
    intro1 = "Coral Gables does not do average — the homes, the streets and the cars all hold a standard, and your detailer should too. BH provides quiet, professional mobile detailing at your residence: we arrive on time, work cleanly under your trees or in your garage, and leave nothing behind but a finished car."
    intro2 = "Family SUVs that survive school runs, weekend classics that only see Sunday mornings, and the daily Mercedes in between — we maintain entire household fleets in the Gables on recurring plans, so every car is always guest-ready."
  },
  @{
    slug = "fort-lauderdale"; city = "Fort Lauderdale"
    h1top = "Yacht-Level Care,"; h1accent = "On Wheels."
    hero = "../assets/photos/IMG_6562-1200w.jpg"
    side = "../assets/photos/IMG_6490-900w.jpg"
    hoods = "Las Olas, Harbor Beach, Rio Vista, Victoria Park, Coral Ridge and greater Broward"
    intro1 = "Fort Lauderdale knows finish quality — this is the yachting capital of the world, where brightwork and gelcoat get more attention than most cars ever see. BH brings that same standard to your driveway: methodical, panel-by-panel detailing for everything from the Las Olas daily driver to the garage queen at Harbor Beach."
    intro2 = "We serve homes, offices and marinas across Broward with the full menu — washes, deep details, machine paint correction and ceramic coatings that stand up to salt air and summer sun. One call covers the car, the truck and the tow vehicle."
  },
  @{
    slug = "boca-raton"; city = "Boca Raton"
    h1top = "Boca Clean Is"; h1accent = "A Level Up."
    hero = "../assets/photos/IMG_8502-1200w.jpg"
    side = "../assets/photos/IMG_6513-900w.jpg"
    hoods = "Royal Palm Yacht Club, Mizner Park, Boca West, Broken Sound and surrounding gated communities"
    intro1 = "In Boca Raton the country club lot looks like a concours, and pulling in with swirled paint gets noticed. BH delivers discreet, scheduled mobile detailing inside gated communities across Boca — we handle gate access, arrive in a clean professional setup, and work quietly at your home."
    intro2 = "Most of our Boca clients are on recurring maintenance plans: weekly, biweekly or monthly visits that keep every vehicle in the garage permanently showroom-ready, with paint correction and ceramic coating handled seasonally. Set it once and never think about it again."
  }
)

foreach ($c in $cities) {
  $out = $tpl.Replace("__CITY__", $c.city).
    Replace("__SLUG__", $c.slug).
    Replace("__H1_TOP__", $c.h1top).
    Replace("__H1_ACCENT__", $c.h1accent).
    Replace("__HERO_IMG__", $c.hero).
    Replace("__SIDE_IMG__", $c.side).
    Replace("__HOODS__", $c.hoods).
    Replace("__INTRO_1__", $c.intro1).
    Replace("__INTRO_2__", $c.intro2)
  [System.IO.File]::WriteAllText("$PSScriptRoot\$($c.slug).html", $out, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Generated $($c.slug).html"
}

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
  },
  @{
    slug = "brickell"; city = "Brickell"
    h1top = "Brickell Towers,"; h1accent = "Mirror Finish."
    hero = "../assets/photos/IMG_1456-1200w.jpg"
    side = "../assets/photos/IMG_6493-900w.jpg"
    hoods = "Brickell Avenue, Mary Brickell Village, the Icon, Echo Brickell and the financial district high-rises"
    intro1 = "Brickell is Miami's vertical city — towers full of exotics parked three levels underground, valet lines, and residents who expect the same polish from their car as from their building's lobby. BH brings the full mobile studio into those garages: quiet, fast and clean, with no mess left on a pristine garage floor."
    intro2 = "Whether it's a quick refresh before a client dinner or a full ceramic coating on a car that rarely sees direct sun, we coordinate with building staff and valet, work around your schedule, and treat every level of the garage like it's the showroom it looks like."
  },
  @{
    slug = "key-biscayne"; city = "Key Biscayne"
    h1top = "Key Biscayne,"; h1accent = "Island Standard."
    hero = "../assets/photos/IMG_1443-1200w.jpg"
    side = "../assets/photos/IMG_6722-900w.jpg"
    hoods = "Crandon Park, Mashta Island, Ocean Club, the Marina and the Village center"
    intro1 = "Key Biscayne is its own world — one bridge in, one bridge out, and a level of privacy most neighborhoods can't match. BH treats it that way: a dedicated mobile appointment at your home, condo or marina slip, with the same quiet, professional setup whether we're working on a daily driver or a weekend exotic that rarely leaves the island."
    intro2 = "The ocean air here is unforgiving on paint and chrome, so most Key residents pair regular hand washes with ceramic coating and a recurring maintenance plan — your car stays protected and presentable without you ever having to think about it."
  },
  @{
    slug = "sunny-isles"; city = "Sunny Isles"
    h1top = "Sunny Isles,"; h1accent = "Reflection Ready."
    hero = "../assets/photos/IMG_1446-1200w.jpg"
    side = "../assets/photos/IMG_1459-900w.jpg"
    hoods = "Millionaire's Row, the barrier-island condo towers and the Golden Beach border"
    intro1 = "Few stretches of road concentrate more glass, chrome and exotic paint per square mile than Sunny Isles. It's also one of the harshest environments for that paint — direct ocean exposure, salt air and constant sun. BH brings the full mobile studio into the towers here, working in resident garages and valet decks up and down Collins Avenue."
    intro2 = "Because of the salt air, we recommend ceramic protection for anything that lives on the island full time — it's the difference between paint that holds its gloss for years and paint that dulls in months. Recurring maintenance plans keep every car in the building ready for a night out, any night."
  },
  @{
    slug = "doral"; city = "Doral"
    h1top = "Doral's Car Culture,"; h1accent = "Runs Deep."
    hero = "../assets/photos/IMG_3725-1200w.jpg"
    side = "../assets/photos/IMG_1462-900w.jpg"
    hoods = "Downtown Doral, the Trump National corridor, Doral Isles and the warehouse and private-garage districts near the airport"
    intro1 = "Doral has one of the largest concentrations of private car collections in South Florida — warehouse garages packed with exotics, classics and weekend builds that need more than an occasional rinse. BH comes to those garages and to the gated communities around Trump National with the same mobile studio setup, panel by panel, every time."
    intro2 = "From keeping a daily-driver fleet clean for a household to a full paint correction and ceramic coating program across a private collection, we work around your schedule and your space — golf community driveway or warehouse bay, it's all the same to us."
  },
  @{
    slug = "aventura"; city = "Aventura"
    h1top = "Aventura,"; h1accent = "Curated Clean."
    hero = "../assets/photos/IMG_1458-1200w.jpg"
    side = "../assets/photos/IMG_6511-900w.jpg"
    hoods = "Williams Island, Turnberry Isle, the Aventura Mall corridor and the Hallandale Beach border"
    intro1 = "Aventura runs on curated everything — from the mall to the marinas to the golf courses at Turnberry. Your car shouldn't be the exception. BH brings concierge mobile detailing to the gated towers and golf communities here, working inside private garages and porte-cocheres without disrupting the building's flow."
    intro2 = "Quick exterior refreshes between shopping trips, full interior resets after the school carpool, or a complete paint correction and ceramic coating on a new arrival — we handle all of it on-site, on your schedule, with the same care we'd give a car on the showroom floor."
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

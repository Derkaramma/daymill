# How I made the demo house

The house you see in the demo, the screenshots and the website isn't my
house, and it isn't anyone's. I didn't want to put my own home on the
internet, so I made a fake one in ChatGPT from scratch. No reference photo,
just a text prompt.

It's set up like a little diorama: the house sits on a floating slab of lawn
on a plain background, so it's easy to cut out and drop into the card.

## Prompt 1: day

New chat, nothing attached:

```text
Photorealistic architectural visualization of a fictional modern single-story California home: clean white stucco walls, warm vertical wood accents, large black-framed windows, a low-slope roof fully covered in sleek black solar panels, a dark gray two-car garage door on the right, a slim gray home battery unit mounted on the left side wall, and a wall-mounted EV charger beside the garage. Empty concrete driveway.

The whole property sits on a thin, flat, floating slab of lush green lawn, like a floating grassy meadow platform. The slab is only a few inches thick, with a clean, soft grass edge all the way around. No exposed soil, no dirt, no rocks underneath, no roots, nothing hanging below. A few olive trees, ornamental grasses, lavender and a stepping-stone path grow on the slab itself, all fully inside its edges.

Soft late-morning sunlight, gentle natural shadows on the house, premium and calm. 3/4 aerial view from the front-left, slightly above. Wide 3:2 landscape image with the floating slab centered and fully visible, with generous empty space on every side.

Background: a perfectly flat, plain, solid light gray (#E6E6E6) studio background. No gradient, no glow, no vignette, no shadow under the slab, no sky, no horizon.

No people, no cars, no text, no logos, no house numbers, no street, no neighboring houses.
```

I went with a flat gray background instead of asking for "transparent".
When I asked for transparent, it painted a fake glow around the house. Flat
gray is easy to cut out cleanly.

## Prompt 2: night

Same chat, right after the day image:

```text
Exact same image, exact same camera, composition and slab, change nothing else: make it blue-hour dusk. Warm golden light glowing from every window, a thin warm LED glow along the roof edges and garage trim, small path lights glowing along the stepping stones, cool blue-hour light on the lawn. Keep the background perfectly flat solid gray (#2A2A2A), no glow, no vignette, no shadow under the slab.
```

## If something's off

- Background has a glow or gradient at the edges: "make the background a
  perfectly flat solid color, no glow or vignette"
- Dirt showing under the slab: "remove all soil underneath, the lawn slab
  should be thin with only a grass edge"
- Night image moved: "keep the exact same camera and composition as the day
  image"

## Prompt 3: the cars

Both generic, no badges, same chat.

```text
A generic, unbadged compact electric hatchback in red: rounded short hood,
split tail lights, no logos, no brand lettering, no model badges, blank
license plate area. Rear 3/4 view from about 2 stories up, as if parked
nose-in on the driveway facing the garage, showing the rear and right side,
with the charge port on the rear-right visible. Transparent background, no
ground or shadow, PNG.
```

```text
Same angle, lighting and rules: a generic unbadged full-size electric pickup
truck in white, plain square tail lights, open bed, charge port on the
front-right fender visible. Transparent background, no logos, no text, PNG.
```

If the transparency comes out fake, run them through a background remover
(see [car-cutout.md](car-cutout.md)).

## Before it goes in the repo

- Zoom to 200% on everything and look for stray text, numbers, logos and
  weird artifacts.
- Check that day and night line up.
- Cut both out the same way so the slab edges match.
- Strip the location and other metadata from every file.

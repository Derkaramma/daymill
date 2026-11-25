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

Same idea as the house: make the cars for this exact picture so they don't
look pasted in. Attach the day render, then ask for one car at a time on a
flat gray background, seen from the same camera as if it were parked in the
driveway. Same chat for both so they match.

```text
Attached is a render of a house. I need a car to place into its driveway later.

Create ONE generic, unbadged compact electric crossover SUV in pearl white, alone on a perfectly flat, plain, solid light gray (#E6E6E6) background.

Show it exactly as it would look parked nose-in on the concrete driveway in front of the garage in the attached image: same camera height, same downward angle, same lens and perspective as the attached render. We see the back of the car and its left side, at the same angle the driveway runs in the picture. Match the soft late-morning lighting of the render exactly.

Charge port door open on the rear left corner, visible.

No logos, no brand lettering, no model badges, blank license plate area. No shadow under the car, no ground, no reflections of a ground surface, no text. Whole car visible with empty space around it. PNG, at least 1500 px wide.
```

```text
Same exact camera angle, perspective, lighting and background as the last image, and the same rules: a generic, unbadged electric pickup truck in dark slate gray, parked nose-in in the other lane of the same driveway, so it sits just to the right of the first car. Charge port on the front left fender, visible. Flat #E6E6E6 background, no shadow, no logos, no text.
```

The flat gray cuts out cleanly. I added the shadows under the tires myself
after cutting them out, which is easier to get right than asking for them.

## Before it goes in the repo

- Zoom to 200% on everything and look for stray text, numbers, logos and
  weird artifacts.
- Check that day and night line up.
- Cut both out the same way so the slab edges match.
- Strip the location and other metadata from every file.

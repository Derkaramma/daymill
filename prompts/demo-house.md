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

## Fixing the entry

The first day render had the window by the front door mounted right on the
wood slats, which isn't how anyone would build it. I fixed it with an edit
instead of starting over, so the cars, battery and lines still fit. New chat,
the day render attached:

```text
Attached is a render I made earlier. Edit ONLY the front entry area. Everything else must stay exactly the same: same camera, same framing, same image size, same house, roof, solar panels, lawn slab, trees, plants, stepping stones, driveway, garage door, wall charger, gray box on the left wall, lighting, and the same flat light gray (#E6E6E6) background. Do not move, resize or redraw anything outside the entry.

What's wrong: to the right of the front door, the black-framed window is mounted on the front face of the wood-slat panel. That's not how it's built.

Fix it like this: the entry is a recessed porch under the flat wood-trimmed entry roof. The back wall of the porch is white stucco and faces the street, parallel to the front of the house. The black-framed window is in that back white stucco wall, to the right of the front door, facing the street. On the right side of the porch is a wood-clad side wall that runs straight out toward the street, perpendicular to the front of the house. From this camera angle we see the inside face of that side wall, angled toward the left. Its front edge lines up with the front edge of the entry roof. That side wall has the same tight vertical wood slat cladding, same warm wood color and same look as the original. The window is set back behind the front edge of that wood wall and is not on the wood at all.

Keep the same wood slat style as the original: solid cladding with tight slats, not an open screen and no gaps you can see through. Keep the wood-clad post on the left of the door, the dark front door and its handle, the entry roof with its wood fascia, and the front step exactly as they are.
```

Then I ran the night prompt again in that same chat. Flip between the old
and new picture to check nothing else moved.

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

## Prompt 4: the battery

Same idea again, for the battery that shows up on the left wall when a
system has one. Attach the day render, same chat as the house.

```text
Attached is a render of a house. I need a home battery to place on its left side wall later, just left of the tall gray box, low on the wall above the bushes.

Create ONE generic, unbranded wall-mounted home battery: a slim, rounded rectangular cabinet in matte white with a thin dark gray side trim and one small status light strip on the front. About half the height of the gray box next to it. Alone on a perfectly flat, plain, solid light gray (#E6E6E6) background.

Show it exactly as it would look mounted flat on that left side wall in the attached image: same camera height, same downward angle, same lens and perspective as the render, so its front faces the same way as that wall. Match the soft late-morning lighting of the render exactly.

No logos, no brand lettering, no text, no cables, no wall, no shadow, no ground. Whole unit visible with empty space around it. PNG, at least 800 px tall.
```

```text
Exact same battery, same camera, angle and size, change nothing else: blue-hour dusk lighting to match the night version of the house, with the front status light strip glowing soft green. Background perfectly flat solid gray (#2A2A2A), no glow, no shadow.
```

The white front is almost the same gray as the background, so a plain color
cut eats into it. I cut it out along its edges instead. The card adds the
soft wall shadow and the glow while it charges or discharges.

## Prompt 5: the "before" photo

The House image page shows a "before" photo next to the render, the kind of
picture an owner would start from. The demo house isn't real, so I asked for
an ordinary phone photo of it. New chat, with only the (fixed) day render
attached. Calling the render a reference and asking for a new photo is what
keeps it looking like a photo instead of another render.

```text
The attached image is a 3D render I use only as a REFERENCE for what a house looks like. Do not edit the render or copy its style. Instead, create a brand-new, real photograph of this exact house, as if I walked up to the real house and took a picture with my iPhone.

The house must match the reference exactly: same shape, same white stucco walls, same black-framed windows in the same places, same dark front door, same gray garage door, same wall charger, same gray box on the left side wall, same olive trees and plantings, black solar panels on the roof. Pay close attention to the front entry: it is a recessed porch under a flat roof with a wood fascia. The window to the right of the front door is on the white back wall of the porch. A wood-slat side wall on the right runs out toward the street, and the window sits behind its front edge, not on the wood. There is a wood-slat post to the left of the door. Do not add, remove or move any feature.

Photo, not a render: taken standing on the sidewalk at the front-left corner of the lot, at eye level (about 5 feet high), looking at the house at an angle so the left side wall and the front are both visible. Only the front edge of the solar roof shows from this low angle. Slight wide-angle phone lens. Natural late-morning sun, real shadows, a little bit of sky, slightly uneven real lawn, a concrete sidewalk and the edge of the street in the foreground, an ordinary suburban neighborhood. A bit of phone-camera noise and imperfect exposure. Not stylized, not too perfect, no floating lawn slab, no studio background.

Empty driveway: no cars, no people, no pets. No text anywhere: no house numbers, no street signs, no license plates, no logos. Any neighboring houses at the edges are blurred and generic.

Landscape 4:3, at least 1600 px wide.
```

It put a blurry house next door, so I followed up with:

```text
Same photo, change nothing else: remove the blurry neighboring house. Where it was, show what would naturally be there instead: a few trees, shrubs and a wood fence along the side of the lot, softly out of focus like the rest of the background. Keep the house, the entry, the camera, the light and the phone-photo look exactly the same.
```

## Before it goes in the repo

- Zoom to 200% on everything and look for stray text, numbers, logos and
  weird artifacts.
- Check that day and night line up.
- Cut both out the same way so the slab edges match.
- Strip the location and other metadata from every file.

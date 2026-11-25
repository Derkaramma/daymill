# Step 1: the daytime house

Here's the exact prompt I used for my own house, with blanks for yours.
Fill in everything in `[brackets]` and delete any line that doesn't apply.

## Photos to attach

Attach as many of these as you have. More photos means fewer made-up details.

1. A daytime photo of the front, from the street
2. A photo from a front corner, at an angle (this is close to the view you want)
3. Close-ups of anything distinctive: the entry, a stone wall, the garage door
4. A top-down view of your roof showing the solar panels. A drone shot is
   great; a Google Maps or Google Earth satellite screenshot works fine.
5. Optional: a night photo, so it knows which lights you have

Crop out your house number, street signs and license plates first.
See [privacy.md](privacy.md).

## The prompt

Before you paste it, count your panels on the top-down view and write down
which roof slope they're on. This is the one thing the tool gets wrong most.

```text
Create a photorealistic, softly stylized 3/4 aerial render of MY house, using
the attached photos as the exact reference. It's for a home energy dashboard,
so the house has to match the photos closely. Do not invent features.

Camera: elevated about 2 stories high at the FRONT-[LEFT/RIGHT] corner of the
lot, looking down about 25 degrees. The [garage / front entry] is nearest, on
the [left/right], and the front of the house faces the viewer at an angle.
Landscape format, 16:10. The whole house is visible with some margin around
it, and the driveway is fully visible.

The house: a [one/two]-story [style, e.g. stucco tract home / ranch /
craftsman / modern farmhouse] with [hip / gable / flat] roofs covered in
[roof material and color]. [Fascia and gutter color]. Walls are
[wall material(s) and color(s)].
- LEFT: [e.g. attached 2-car garage, door style and color, wall lights, driveway]
- CENTER: [front entry: door color, porch, covered or recessed]
- RIGHT: [the other wing: stories, windows, shutters, trim, stone or brick]
- [Anything else: block walls, fences, side gates]

Solar: exactly [N] [all-black / silver-frame] solar panels, placed exactly as
in the top-down roof photo.
- [N1] panels on the [which] roof slope, arranged as [rows x columns / pairs]
- [N2] panels on the [which] roof slope, arranged as [...]
- No panels on [roof sections that have none]

Landscaping: [lawn / gravel / drought-tolerant plants / trees / path lights].
A sidewalk and street run along the bottom.

Style: clean, bright, soft daylight. Realistic materials, slightly idealized
like an architectural visualization.

The driveway is EMPTY: no cars, no people. No text, no labels, no logos, no
house numbers, no street signs, no license plates. No chimneys, dormers,
balconies or windows that aren't in the photos.
```

## Check it before moving on

- Count the panels. Really count them.
- Look for stuff that isn't on your house: extra windows, a chimney, a
  second garage door, a porch you don't have.
- Zoom in on the garage and the curb for any numbers or text.
- Make sure the driveway is empty and fully in frame.

If anything's off, use [fix-it.md](fix-it.md) in the same chat. Don't move on
to the night version until you're happy with this one, because the night
version copies whatever's here.

Download it as a full-size image. Name it something like `house-day.jpg`.

Next: [house-night.md](house-night.md)

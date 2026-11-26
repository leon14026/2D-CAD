# ArchiLite drawing file format (version 1)

ArchiLite saves drawings as UTF-8 JSON text with the extension `.archilite`. The format is plain and
documented so you can read, diff, generate and repair drawings with any text editor or script.

An example ships with the app: [`public/examples/bracket.archilite`](../public/examples/bracket.archilite).
Open it in the [file inspector](https://leon14026.github.io/2D-CAD/inspect.html) to see what it
contains.

## Layout

```json
{
  "format": "archilite",
  "version": 1,
  "title": "Example bracket",
  "units": "mm",
  "currentLayer": 2,
  "nextId": 21,
  "layers": [
    {"id":2,"name":"Outline","color":"#1f2a33","linetype":"continuous","lineweight":0.5,"visible":true,"locked":false}
  ],
  "entities": [
    {"id":6,"layer":3,"z":6,"color":"byLayer","linetype":"byLayer","lineweight":"byLayer","geom":{"kind":"circle","center":{"x":10,"y":10},"radius":4}}
  ]
}
```

ArchiLite always writes one layer or entity per line, entities in drawing order, so the same drawing
always produces the same text and changes show up as clean line diffs in git.

## Top-level fields

All fields are required. Any field not listed here is rejected.

| Field | Type | Meaning |
|---|---|---|
| `format` | `"archilite"` | Identifies the file. |
| `version` | whole number | File format version. This document describes version **1**. A file with a higher version is refused with a message saying a newer ArchiLite saved it. |
| `title` | text, 1–200 characters | Drawing title. Leading and trailing spaces are removed. |
| `units` | `"mm"`, `"cm"`, `"m"`, `"in"` or `"ft"` | What one drawing unit means. All coordinates and radii are in these units. |
| `currentLayer` | layer id | The layer new entities go on. |
| `nextId` | whole number | The next id ArchiLite will hand out. Must be greater than every id in the file. |
| `layers` | list of layers | At least one. The order is the order shown in the layer list. |
| `entities` | list of entities | May be empty. |

Layers and entities share **one id space**: an id can't belong to a layer and an entity at once.
Ids are whole numbers from 1 up.

## Layer

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `name` | text, 1–64 characters | Unique, ignoring upper/lower case. |
| `color` | `"#rrggbb"` (lowercase hex) | Colour of entities that use `byLayer`. |
| `linetype` | linetype name (below) | Linetype of entities that use `byLayer`. |
| `lineweight` | lineweight (below) | Line width on paper, in mm, for entities that use `byLayer`. |
| `visible` | `true` / `false` | Whether the layer is shown. |
| `locked` | `true` / `false` | A locked layer's entities can't be added, changed or deleted. |

## Entity

| Field | Type | Meaning |
|---|---|---|
| `id` | whole number | Unique id. |
| `layer` | layer id | Must be an existing layer. |
| `z` | number | Drawing order: lower is drawn first. Ties are broken by id. New entities get `z = id`. |
| `color` | `"byLayer"` or `"#rrggbb"` | Own colour, or the layer's. |
| `linetype` | `"byLayer"` or a linetype name | |
| `lineweight` | `"byLayer"` or a lineweight | |
| `geom` | shape (below) | The geometry. |

## Shapes

Coordinates are in drawing units with **y pointing up**. Angles are in **radians**, measured
anticlockwise from the +x axis.

| `kind` | Other fields | Rules |
|---|---|---|
| `"segment"` | `start`, `end`: `{"x":…, "y":…}` | Start and end must differ. |
| `"circle"` | `center`, `radius` | Radius greater than 0. |
| `"arc"` | `center`, `radius`, `start`, `sweep` | `start` is the start angle; ArchiLite stores it in [0, 2π). `sweep` is signed: positive runs anticlockwise, negative clockwise, with 0 < \|sweep\| < 2π. |
| `"polyline"` | `vertices`, `closed` | At least two vertices, each `{"x":…, "y":…, "bulge":…}`. `closed: true` joins the last vertex back to the first. |

**Bulge** describes the edge from a vertex to the next one, using the same convention as the DXF
format's lightweight polylines:

- `0` is a straight edge (and is the default if `bulge` is left out);
- otherwise `bulge = tan(sweep / 4)`, where `sweep` is the arc's angle;
- positive bulges arc anticlockwise, negative bulges clockwise;
- `1` is a half circle, and `tan(π/8) ≈ 0.4142` is a quarter circle (a 90° corner fillet).

## Styles

**Linetypes** are ArchiLite's own, using the element proportions of ISO 128-20 (lengths in multiples
of the line width *d*):

| Name | ISO 128 type | Pattern (dash, gap, …) | Typical use |
|---|---|---|---|
| `continuous` | 01 | solid | visible outlines |
| `dashed` | 02 | 12d, 3d | hidden detail |
| `dash-dot` | 04 | 24d, 3d, 0.5d, 3d | centre lines |
| `dash-double-dot` | 05 | 24d, 3d, 0.5d, 3d, 0.5d, 3d | phantom and adjacent parts |
| `dotted` | 07 | 0.5d, 3d | |

**Lineweights** are the ISO 128 series, in mm on paper: `0.13`, `0.18`, `0.25`, `0.35`, `0.5`, `0.7`,
`1`, `1.4`, `2`. They don't change with the drawing's units.

## Numbers

- Every number must be finite. `NaN` and `Infinity` can't be written in JSON. Values too large
  for a double, such as `1e999`, are refused rather than read as infinity.
- ArchiLite writes the shortest decimal that reads back to exactly the same value, so saving and
  loading never changes geometry.
- `-0` is stored as `0`.

## When a file is refused

The app and the file inspector report the first problem found, in plain words, with its location:

```text
Problem in the drawing file at entities[1].geom.radius: radius must be a positive finite number, got -4.
```

The location reads like a path: `entities[1]` is the second entity (counting from 0), `.geom.radius`
its radius.

## Versioning

- A change that older ArchiLite versions could misread raises `version`.
- ArchiLite opens files with its own version or lower, and refuses higher versions with a clear
  message rather than guessing.

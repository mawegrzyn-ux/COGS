# COGS Doc Library — HTML Document Authoring Guide

You are creating an HTML document that will be uploaded to the COGS Manager app via its "Upload HTML" button in the Doc Library. Follow these rules exactly.

---

## How the upload works

1. The user uploads a `.html` file
2. The server extracts the `<body>` content and any `<style>` blocks
3. The `<head>`, `<html>`, and `<body>` tags themselves are stripped — only the **inner content** of `<body>` plus any `<style>` blocks are kept
4. The HTML is rendered inside a `<div class="doc-rendered-content">` wrapper
5. Content is sanitized with DOMPurify (allows `<style>` tags and `target`/`rel` attributes)
6. A table of contents is auto-generated from any `<h1>`, `<h2>`, `<h3>` tags that have `id` attributes

---

## File structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Your Document Title</title>
  <style>
    /* Your custom styles go here — these ARE preserved */
  </style>
</head>
<body>
  <!-- Your content here -->
</body>
</html>
```

- The `<title>` tag is used as the default document title in the library
- Everything inside `<body>` becomes the document content
- All `<style>` blocks (from anywhere in the file) are extracted and prepended to the content

---

## Built-in styles you get for free

The viewer wrapper (`.doc-rendered-content`) already applies these styles. You do **not** need to restyle these elements unless you want to override them:

| Element | Built-in style |
|---------|---------------|
| `<h1>` | 1.75rem, bold, dark text (#0F1F17), top/bottom margin |
| `<h2>` | 1.375rem, bold, dark text |
| `<h3>` | 1.125rem, semibold, dark text |
| `<p>` | 0.5rem margin, 1.6 line-height, secondary text colour (#2D4A38) |
| `<ul>` | Disc bullets, 1.5rem left padding |
| `<ol>` | Decimal numbers, 1.5rem left padding |
| `<li>` | Secondary text colour |
| `<a>` | Green (#146A34), underlined |
| `<img>` | Max-width 100%, 0.5rem rounded corners |
| `<table>` | Full width, collapsed borders, green-tinted border (#D8E6DD) |
| `<th>` | Light gray background (#F7F9F8), semibold, 0.875rem |
| `<td>` | 0.875rem font, 1px border, 0.375rem/0.75rem padding |
| `<blockquote>` | Green left border (#146A34), italic, muted text |
| `<pre>` | Light gray background (#f5f5f5), rounded, monospace |
| `<code>` | Inline gray background (#f0f0f0), monospace, 0.8125rem |
| `<hr>` | Thin green-tinted border line |

---

## Design system colours

Use these CSS custom properties (already defined in the app):

| Variable | Hex | Usage |
|----------|-----|-------|
| `var(--accent)` | `#146A34` | Primary green — buttons, links, active states |
| `var(--accent-mid)` | `#1E8A44` | Hover green |
| `var(--accent-dim)` | `#E8F5ED` | Light green backgrounds |
| `var(--accent-dark)` | `#0D4D26` | Dark green / pressed state |
| `var(--surface)` | `#FFFFFF` | White backgrounds |
| `var(--surface-2)` | `#F7F9F8` | Light gray page backgrounds |
| `var(--text-1)` | `#0F1F17` | Primary text (headings) |
| `var(--text-2)` | `#2D4A38` | Secondary text (body copy) |
| `var(--text-3)` | `#6B7F74` | Muted / placeholder text |
| `var(--border)` | `#D8E6DD` | All borders |

You can also use the hex values directly in inline styles if you prefer.

---

## Font

The app uses **Nunito** (Google Font) at 15px base size. Your document inherits this automatically. Do not set a different body font unless intentional.

Monospace font stack: `ui-monospace, SFMono-Regular, monospace`

---

## Table of Contents (auto-generated)

The viewer automatically builds a left sidebar TOC from `<h1>`, `<h2>`, `<h3>` elements. For headings to appear in the TOC, they **must** have an `id` attribute:

```html
<h1 id="overview">Overview</h1>
<h2 id="getting-started">Getting Started</h2>
<h3 id="prerequisites">Prerequisites</h3>
```

- Headings **without** `id` still render normally but won't appear in the TOC navigation
- Use lowercase kebab-case for IDs: `id="my-section-name"`

---

## What NOT to do

1. **No `<script>` tags** — DOMPurify strips all JavaScript
2. **No external stylesheets** (`<link rel="stylesheet">`) — stripped on upload. Put all CSS in `<style>` blocks
3. **No external fonts** via `@import` or `<link>` — Nunito is already loaded globally
4. **No `onclick` or event handler attributes** — stripped by sanitizer
5. **No `<iframe>` or `<embed>`** — stripped by sanitizer
6. **No `<form>` elements** — documents are read-only, not interactive pages
7. **Don't override `.doc-rendered-content` styles globally** — scope your custom styles with a wrapper class

---

## Custom styling approach

If you need custom styles beyond the built-ins, wrap your content in a `<div>` with a unique class and scope all styles to it:

```html
<style>
  .my-doc .info-box {
    border: 1px solid var(--border);
    background: var(--accent-dim);
    border-radius: 8px;
    padding: 12px 16px;
    margin: 12px 0;
  }
  .my-doc .info-box .title {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .my-doc .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
    margin-right: 8px;
  }
</style>

<div class="my-doc">
  <h1 id="title">My Document</h1>
  <div class="info-box">
    <div class="title">Tip</div>
    <p>Scoped styles keep things clean.</p>
  </div>
</div>
```

---

## Recommended reusable patterns

### Info / callout boxes

```html
<!-- Tip (green) -->
<div style="border:1px solid #D8E6DD; background:#E8F5ED; border-radius:8px; padding:12px 16px; margin:12px 0;">
  <p style="font-size:0.75rem; font-weight:700; color:#146A34; margin:0 0 4px;">Tip</p>
  <p style="font-size:0.75rem; color:#146A34; margin:0; line-height:1.5;">Your tip text here.</p>
</div>

<!-- Info (blue) -->
<div style="border:1px solid #bfdbfe; background:#eff6ff; border-radius:8px; padding:12px 16px; margin:12px 0;">
  <p style="font-size:0.75rem; font-weight:700; color:#1e40af; margin:0 0 4px;">Note</p>
  <p style="font-size:0.75rem; color:#1e40af; margin:0; line-height:1.5;">Informational text here.</p>
</div>

<!-- Warning (amber) -->
<div style="border:1px solid #fde68a; background:#fffbeb; border-radius:8px; padding:12px 16px; margin:12px 0;">
  <p style="font-size:0.75rem; font-weight:700; color:#92400e; margin:0 0 4px;">Warning</p>
  <p style="font-size:0.75rem; color:#92400e; margin:0; line-height:1.5;">Warning text here.</p>
</div>

<!-- Critical (red) -->
<div style="border:1px solid #fecaca; background:#fef2f2; border-radius:8px; padding:12px 16px; margin:12px 0;">
  <p style="font-size:0.75rem; font-weight:700; color:#991b1b; margin:0 0 4px;">Critical</p>
  <p style="font-size:0.75rem; color:#991b1b; margin:0; line-height:1.5;">Critical warning text here.</p>
</div>
```

### Numbered steps

```html
<div style="display:flex; gap:12px; margin:12px 0;">
  <div style="width:24px; height:24px; border-radius:50%; background:#146A34; color:white; font-size:0.75rem; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:2px;">1</div>
  <div>
    <p style="font-weight:600; font-size:0.875rem; color:#0F1F17; margin:0;">Step Title</p>
    <p style="font-size:0.875rem; color:#2D4A38; margin:4px 0 0;">Step description text.</p>
  </div>
</div>
```

### Process flow (horizontal arrows)

```html
<div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:12px; background:white; border:1px solid #D8E6DD; border-radius:8px; margin:16px 0;">
  <div style="background:#E8F5ED; border:1px solid rgba(20,106,52,0.2); border-radius:4px; padding:6px 10px; text-align:center;">
    <div style="font-size:0.75rem; font-weight:700; color:#146A34;">Step 1</div>
    <div style="font-size:0.625rem; color:#6B7F74;">subtitle</div>
  </div>
  <span style="color:#6B7F74;">&#8594;</span>
  <div style="background:#E8F5ED; border:1px solid rgba(20,106,52,0.2); border-radius:4px; padding:6px 10px; text-align:center;">
    <div style="font-size:0.75rem; font-weight:700; color:#146A34;">Step 2</div>
  </div>
  <span style="color:#6B7F74;">&#8594;</span>
  <div style="background:#E8F5ED; border:1px solid rgba(20,106,52,0.2); border-radius:4px; padding:6px 10px; text-align:center;">
    <div style="font-size:0.75rem; font-weight:700; color:#146A34;">Step 3</div>
  </div>
</div>
```

### Badge / pill

```html
<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-size:0.6875rem; font-weight:600; background:#E8F5ED; color:#146A34;">Active</span>
<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-size:0.6875rem; font-weight:600; background:#fffbeb; color:#92400e;">Pending</span>
<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-size:0.6875rem; font-weight:600; background:#f3f4f6; color:#6b7280;">Inactive</span>
```

### Key-value definition list

```html
<table>
  <tr><th>Field</th><th>Value</th></tr>
  <tr><td>App Name</td><td>COGS Manager</td></tr>
  <tr><td>Version</td><td>2.5</td></tr>
  <tr><td>Database</td><td>PostgreSQL 16</td></tr>
</table>
```

---

## Complete minimal example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Getting Started with COGS</title>
</head>
<body>

<h1 id="overview">Getting Started with COGS</h1>
<p>This guide walks you through initial setup of the COGS Manager.</p>

<h2 id="prerequisites">Prerequisites</h2>
<ul>
  <li>An active user account (approved by an Admin)</li>
  <li>At least one market configured with currency and tax rates</li>
</ul>

<h2 id="steps">Setup Steps</h2>

<h3 id="step-1">1. Configure Your Market</h3>
<p>Navigate to <strong>Configuration</strong> and set up your country with the correct currency code, exchange rate, and default price level.</p>

<div style="border:1px solid #fde68a; background:#fffbeb; border-radius:8px; padding:12px 16px; margin:12px 0;">
  <p style="font-size:0.75rem; font-weight:700; color:#92400e; margin:0 0 4px;">Warning</p>
  <p style="font-size:0.75rem; color:#92400e; margin:0;">Exchange rates must be set relative to USD base. Use the sync button to pull live rates.</p>
</div>

<h3 id="step-2">2. Add Ingredients</h3>
<p>Go to <strong>Inventory &rarr; Ingredients</strong> and add your ingredient library with base units and waste percentages.</p>

<table>
  <tr><th>Field</th><th>Required</th><th>Notes</th></tr>
  <tr><td>Name</td><td>Yes</td><td>Must be unique</td></tr>
  <tr><td>Base Unit</td><td>Yes</td><td>e.g. kg, litre, each</td></tr>
  <tr><td>Waste %</td><td>No</td><td>0-100, applied to cost calculation</td></tr>
  <tr><td>Category</td><td>No</td><td>For grouping and filtering</td></tr>
</table>

<h2 id="next-steps">Next Steps</h2>
<p>Once ingredients are in, proceed to <strong>Price Quotes</strong> to add vendor pricing, then build your <strong>Recipes</strong>.</p>

</body>
</html>
```

---

## Size limit

Maximum file size: **10 MB**. Keep images external (use URLs) or inline as base64 only if small. Large embedded base64 images will bloat the document and slow rendering.

---

## Quick reference — text sizes used in the app

| Size | CSS | Use for |
|------|-----|---------|
| Body | `0.875rem` (14px) | Paragraphs, table cells |
| Small | `0.75rem` (12px) | Labels, callout text, badges |
| Tiny | `0.625rem` (10px) | Subtitles, fine print |
| Mono | `0.8125rem` (13px) | Code blocks, inline code |
| H1 | `1.75rem` (28px) | Page title |
| H2 | `1.375rem` (22px) | Section heading |
| H3 | `1.125rem` (18px) | Subsection heading |

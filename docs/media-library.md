# Epic: Media Library

A modal image library that lets admins upload, organize, browse, select, and edit images used throughout the app. Works both as a **picker** (returns a URL to a caller) and as a **manager** (standalone browsing/organizing). Images are scoped either to a specific form or to a shared global library, and can be tagged into user-defined categories.

---

## Scope

### In scope
- Modal dialog with fixed and fullscreen modes
- Upload (button + drag-and-drop, single + multi, with progress chips)
- Duplicate detection before upload
- Browsing with grid and list views
- Search by filename
- Categories (user-created, rename/delete)
- Scope filters: All / No-category / specific category, plus form filter
- Single and multi-select
- Single-item detail panel (preview, metadata, rename, change category, edit, delete)
- Multi-select bulk actions (bulk move to category, bulk delete)
- Move items between form-specific and shared (global) scope
- Image editor entry point (crop/edit existing image)
- Insert-into-caller flow (picker mode returns a URL via callback)
- Resizable detail panel

### Out of scope
- Video / audio / document uploads (images only)
- Versioning / history of edits
- External source import (Unsplash, URL paste, etc.)
- Folder nesting (categories are flat)
- Permission/sharing controls per item

---

## Personas
- **Admin/Editor** — opens the library to pick an image while configuring something, or to manage the asset collection directly.

---

## User Stories

### Opening & modes

**US-1: Open as picker**
As an editor, when I click "Choose from library" on any image field, I want the Media Library modal to open and return the URL of whatever image I select, so the field gets populated.
- **Acceptance:**
  - Modal opens with an "Insert selected" CTA (disabled until a selection exists)
  - Selecting an item and clicking Insert closes the modal and passes the URL back to the caller
  - Closing without selecting returns nothing; caller state unchanged

**US-2: Open as manager**
As an editor, I want to open the library in a standalone "manage" mode with no insert action, so I can organize assets without being mid-task.
- **Acceptance:**
  - Insert button is hidden/disabled
  - All browse, upload, edit, delete, and category actions remain available

**US-3: Toggle fullscreen**
As an editor, I want to toggle the modal between fixed-size and fullscreen, so I can see more thumbnails on large screens.
- **Acceptance:**
  - Fullscreen button swaps the modal to 100vw/100vh with no rounded corners
  - State is visual only; no persistence required between opens

**US-4: Close the modal**
As an editor, I want to close the modal via the X button, the footer Close button, or the ESC key, so I can dismiss it quickly.

---

### Browsing

**US-5: See images in a grid**
As an editor, I want images shown as square thumbnails in a responsive grid, so I can visually scan the collection.
- **Acceptance:**
  - Thumbnails fill available width (auto-fill, min 110px)
  - Images are object-fit: cover, 1:1 aspect
  - Hovering an item shows a highlight
  - Selected items show a prominent accent border

**US-6: Switch to list view**
As an editor, I want a list view alternative to the grid, so I can see filenames, sizes, and metadata at a glance.
- **Acceptance:**
  - Toolbar has grid/list toggle buttons
  - Active view mode is visually indicated

**US-7: Item count**
As an editor, I want to see how many items match the current filter, so I know the size of what I'm looking at.

**US-8: Empty state**
As an editor, when no items match the current filter, I want a friendly empty-state message prompting me to upload.

---

### Search & filtering

**US-9: Search by filename**
As an editor, I want a search box that filters the visible items by filename as I type, so I can find a specific image quickly.
- **Acceptance:**
  - Filtering happens on the client (live as-you-type)
  - Works in combination with category and form filters

**US-10: Filter by category**
As an editor, I want to click a category in the sidebar to show only items in that category, so I can narrow the view.
- **Acceptance:**
  - "All media" shows everything
  - "No category" shows uncategorized items only
  - Clicking a named category filters to that category
  - Active category is visually highlighted

**US-11: Filter by form**
As an editor, I want to filter items by which form they belong to (or show shared only), so I can see exactly what's in play for a given form.
- **Acceptance:**
  - Dropdown lists all forms plus "All forms"
  - Combines with category and search filters

---

### Categories

**US-12: Create a category**
As an editor, I want to create a new named category from the sidebar, so I can organize my uploads.

**US-13: Rename/delete a category**
As an editor, I want to rename or delete an existing category, so I can keep the taxonomy clean.
- **Acceptance:**
  - Deleting a category does not delete its items; they become "No category"

**US-14: Upload into a specific category**
As an editor, I want to pick a target category from a dropdown before I upload, so new files are auto-tagged.
- **Acceptance:**
  - Default is "No category"
  - Selected category persists for subsequent uploads within the same session

---

### Upload

**US-15: Upload via button**
As an editor, I want an Upload button that opens a multi-file picker restricted to images, so I can add files.
- **Acceptance:**
  - Accept filter: `image/*`
  - Supports selecting multiple files in one go

**US-16: Upload via drag-and-drop**
As an editor, I want to drag image files onto the modal to upload them, so I don't have to click through a dialog.
- **Acceptance:**
  - A drop overlay appears when files are dragged over the modal
  - Overlay disappears on drop or drag-leave
  - Dropped files enter the same upload pipeline as the button

**US-17: Upload progress chips**
As an editor, I want each uploading file to show as a chip with live status, so I know which ones finished and which failed.
- **Acceptance:**
  - Chips appear above the grid during upload
  - Each chip shows filename and status (uploading / done / error)
  - Chips clear after all uploads resolve

**US-18: Duplicate detection before upload**
As an editor, when I try to upload a file whose filename already exists in the current scope, I want to be warned and given a choice (replace, keep both, cancel), so I don't clutter the library.
- **Acceptance:**
  - Duplicate check runs per file before the actual upload
  - Check is scoped: form-specific duplicates vs shared duplicates are separate

---

### Selection

**US-19: Single select**
As an editor, I want clicking an item to select it, so I can see details and act on it.
- **Acceptance:**
  - Clicking a second item replaces the selection
  - Selected item opens in the right detail panel

**US-20: Multi-select**
As an editor, I want to select multiple items (via per-item checkbox or modifier-click), so I can act on them in bulk.
- **Acceptance:**
  - Each thumbnail has a hover-revealed checkbox
  - Multi-select switches the right panel from "single detail" to "multi actions"
  - Count of selected items is visible, clickable to clear

**US-21: Clear selection**
As an editor, I want a one-click way to clear my current multi-selection, so I can start over.

---

### Detail panel (single item)

**US-22: Preview metadata**
As an editor, when one item is selected, I want to see a large preview plus metadata (filename, dimensions, size, upload date, category, scope), so I can confirm it's the right file.

**US-23: Rename an item**
As an editor, I want to edit an item's filename inline in the detail panel, so I can give it a meaningful name.

**US-24: Change category (single)**
As an editor, I want to change the category of a single selected item from the detail panel, so I can reorganize on the fly.

**US-25: Edit image**
As an editor, I want an "Edit image" button that launches the image editor on the selected file, so I can crop or adjust without leaving the library.

**US-26: Delete single item**
As an editor, I want to delete the selected item with confirmation, so I can remove unwanted files.
- **Acceptance:**
  - Confirmation required before delete
  - Both the stored file and its DB record are removed
  - View updates without a full reload

**US-27: Resize the detail panel**
As an editor, I want to drag the left edge of the detail panel to resize it, so I can see bigger previews.

---

### Bulk actions (multi-select)

**US-28: Bulk move to category**
As an editor, with multiple items selected, I want to move them all into one category at once.

**US-29: Bulk delete**
As an editor, with multiple items selected, I want to delete them all at once with a single confirmation.

---

### Scope (form vs shared)

**US-30: Move between form and shared**
As an editor, I want to move an item from a form's library into the shared global library (and vice versa), so assets can be reused across forms.
- **Acceptance:**
  - Shared items are visually marked
  - Moving does not re-upload; only the scope changes

**US-31: Scope indicator**
As an editor, I want the modal header to show which form (if any) is the current scope, so I know where uploads will land by default.

---

### Insert / return flow

**US-32: Insert selected back into caller**
As an editor, after selecting an item in picker mode, clicking "Insert selected" must close the modal and deliver the image URL to whatever field opened the picker.
- **Acceptance:**
  - Button is disabled until exactly one item is selected
  - Callback fires with the public URL of the item
  - Modal closes on success

---

## Non-functional requirements

- **Responsive:** usable from ~500px wide up to fullscreen desktop
- **Keyboard:** ESC closes; focus trapped within the modal while open
- **Performance:** thumbnails lazy-load; grid handles hundreds of items without jank
- **State isolation:** opening the modal twice should not leak selection/scroll from a prior open
- **Accessibility:** all icon-only buttons have `title`/`aria-label`; selected state is not color-only

---

## Key UI elements (for reference)

| Region | Purpose |
|---|---|
| Header | Title, scope indicator, fullscreen toggle, close |
| Left sidebar | Search, category list, "New category", form filter, upload-to-category selector, Upload button |
| Main area | View toolbar (count + grid/list toggle), upload progress chips, image grid/list, empty state |
| Right detail panel | Resizer handle, empty state, single-item preview+actions, multi-select actions |
| Footer | Close, Insert selected (picker mode only) |
| Drop overlay | Full-area drag-and-drop target |
| Category popup | Shared popover for "change category" actions |

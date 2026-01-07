# Adding Your Club Logo

## Quick Setup

1. **Prepare your logo image:**

   - File format: PNG (with transparent background recommended)
   - Recommended size: 300x300px or higher
   - Name it: `logo.png`

2. **Add to your project:**

   - Place `logo.png` in the `/public` folder of your project

   ```
   motorcycle-club-app/
   ├── public/
   │   ├── logo.png  ← Put your logo here
   │   ├── index.html
   │   └── manifest.json
   ```

3. **That's it!** The logo will automatically appear:
   - On the login page (above H616 text)
   - In the header next to H616 (when logged in)

## Logo Specifications

### Login Page Logo:

- Max width: 120px
- Has a glowing effect in bone color
- Centered above the H616 text

### Header Logo:

- Height: 40px
- Width: auto-scaled
- Next to H616 text in the header

## If Logo Doesn't Appear

The code has a fallback - if `logo.png` doesn't exist, it simply won't show (no errors).

To test:

1. Add your `logo.png` to `/public`
2. Restart your dev server: `npm start`
3. Hard refresh the page: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

## Customizing Logo Size

Edit these files if you want different sizes:

**For login page** (`src/pages/Login.css`):

```css
.club-logo {
  max-width: 120px; /* Change this */
  height: auto;
}
```

**For header** (`src/components/Layout.css`):

```css
.header-logo {
  height: 40px; /* Change this */
  width: auto;
}
```

## Using a Different Logo Name

If your logo file has a different name (like `h616-logo.png`), update these files:

1. `src/pages/Login.js` - line with `src="/logo.png"`
2. `src/components/Layout.js` - line with `src="/logo.png"`

Change `/logo.png` to `/your-logo-name.png`

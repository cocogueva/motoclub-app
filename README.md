# Motorcycle Club Management App 🏍️

A Progressive Web App (PWA) for managing motorcycle club memberships, payments, and member information. Built with React and Supabase.

## Features

- 🔐 **Magic Link Authentication** - No passwords needed, just email
- 👥 **Member Directory** - View all club members with their bikes and contact info
- 💰 **Payment Tracking** - Upload payment vouchers and track dues
- 📱 **Mobile-First Design** - Works perfectly on phones, tablets, and desktop
- 🎨 **Distinctive Design** - Motorcycle-themed UI with custom styling
- 📊 **Dashboard** - Quick overview of club stats
- 💾 **Cloud Storage** - All data and images stored securely

## Tech Stack

- **Frontend**: React 18
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **Styling**: Custom CSS with motorcycle theme
- **Hosting**: Can be deployed to Netlify, Vercel, or any static host

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A Supabase account (free tier is fine)

## Installation & Setup

### 1. Clone and Install Dependencies

```bash
cd motorcycle-club-app
npm install
```

### 2. Set Up Supabase

1. Go to [https://supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Wait for the project to be set up (takes about 2 minutes)

### 3. Create Database Tables

In your Supabase project, go to the SQL Editor and run these commands:

```sql
-- Create members table
CREATE TABLE members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  foto TEXT,
  nombre TEXT,
  apellido TEXT,
  apodo TEXT,
  puesto TEXT,
  telefono TEXT,
  email TEXT,
  tipo_sangre TEXT,
  marca_moto TEXT,
  modelo TEXT,
  placa TEXT,
  cilindrada TEXT,
  contacto_emergencia TEXT,
  telefono_emergencia TEXT
);

-- Create payments table
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  fecha TIMESTAMP WITH TIME ZONE,
  monto INTEGER,
  mes_pagado TEXT,
  voucher TEXT,
  email_registro TEXT,
  comentario TEXT,
  tipo_ingreso TEXT
);

-- Enable Row Level Security
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Create policies for members (all authenticated users can read)
CREATE POLICY "Members are viewable by authenticated users"
  ON members FOR SELECT
  TO authenticated
  USING (true);

-- Create policies for payments (users can only see their own)
CREATE POLICY "Users can view own payments"
  ON payments FOR SELECT
  TO authenticated
  USING (auth.email() = email_registro);

CREATE POLICY "Users can insert own payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = email_registro);
```

### 4. Create Storage Bucket

1. In Supabase, go to **Storage**
2. Click **New bucket**
3. Name it `payments`
4. Make it **Public**
5. Click **Create bucket**

### 5. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. In Supabase, go to **Project Settings** > **API**

3. Copy these values to your `.env` file:
   - **Project URL** → `REACT_APP_SUPABASE_URL`
   - **anon/public key** → `REACT_APP_SUPABASE_ANON_KEY`

Your `.env` should look like:
```
REACT_APP_SUPABASE_URL=https://xxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your_long_anon_key_here
```

### 6. Run the App

```bash
npm start
```

The app will open at `http://localhost:3000`

## Importing Existing Data from Google Sheets

If you have existing data in Google Sheets (like your current Glide app), you can import it:

### Option 1: Manual CSV Import
1. Export your Google Sheets as CSV
2. In Supabase, go to **Table Editor**
3. Select your table (members or payments)
4. Click **Insert** > **Import data from CSV**
5. Upload your CSV file

### Option 2: Using Google Sheets API (for ongoing sync)
We can set up a sync script later if you want to keep Google Sheets as a backup/editing interface.

## Deployment

### Deploy to Netlify (Recommended)

1. Create a Netlify account at [netlify.com](https://netlify.com)
2. Connect your GitHub repository
3. Add environment variables in Netlify dashboard:
   - `REACT_APP_SUPABASE_URL`
   - `REACT_APP_SUPABASE_ANON_KEY`
4. Deploy!

Build settings:
- **Build command**: `npm run build`
- **Publish directory**: `build`

### Deploy to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Add environment variables when prompted
4. Done!

## Usage

### For Members
1. Go to the app URL
2. Enter your email
3. Check your email for the magic link
4. Click the link to log in
5. Upload payment vouchers in the Payments section

### For Admins
- All members can see the member directory
- Payment data is private (each user sees only their own)
- To make admin features, we can add a `role` column to members table

## Customization

### Change Colors
Edit `src/App.css` and modify the CSS variables:
```css
:root {
  --color-spark: #ff6b35;  /* Your primary color */
  --color-flame: #ff4500;  /* Hover color */
  /* ... etc */
}
```

### Change Club Name
Edit `src/components/Layout.js` and change "H616" to your club name.

### Add More Features
The codebase is modular. You can:
- Add more pages in `src/pages/`
- Add more components in `src/components/`
- Extend the database schema in Supabase

## Selling to Other Clubs

To make this a multi-tenant app for other clubs:

1. Add a `clubs` table
2. Add `club_id` foreign keys to members and payments
3. Modify authentication to assign users to clubs
4. Update Row Level Security policies to filter by club_id
5. Create a signup flow for new clubs

I can help you with this if you want to commercialize it!

## Troubleshooting

### "Missing Supabase environment variables"
- Make sure your `.env` file exists and has the correct variables
- Restart the development server after creating `.env`

### "Failed to fetch" errors
- Check your Supabase project is not paused (free tier pauses after 1 week of inactivity)
- Verify your environment variables are correct

### Images not uploading
- Make sure the `payments` storage bucket is set to **Public**
- Check the bucket policies in Supabase Storage settings

## Support

For questions or issues, check:
- Supabase docs: [https://supabase.com/docs](https://supabase.com/docs)
- React docs: [https://react.dev](https://react.dev)

## License

MIT - Feel free to use this for your club and others!

---

Made with ⚡ for motorcycle enthusiasts

-- Motorcycle Club App - Supabase Database Setup
-- Run this entire script in the Supabase SQL Editor

-- =============================================================================
-- 1. CREATE TABLES
-- =============================================================================

-- Members Table
CREATE TABLE IF NOT EXISTS members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Personal Info
  foto TEXT,
  nombre TEXT,
  apellido TEXT,
  apodo TEXT,
  email TEXT UNIQUE,
  telefono TEXT,
  tipo_sangre TEXT,
  puesto TEXT,
  
  -- Motorcycle Info
  marca_moto TEXT,
  modelo TEXT,
  placa TEXT,
  cilindrada TEXT,
  
  -- Emergency Contact
  contacto_emergencia TEXT,
  telefono_emergencia TEXT
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Payment Info
  fecha TIMESTAMP WITH TIME ZONE NOT NULL,
  monto INTEGER NOT NULL,
  mes_pagado TEXT NOT NULL,
  comentario TEXT,
  tipo_ingreso TEXT DEFAULT 'Cuota',
  
  -- Voucher & User
  voucher TEXT,
  email_registro TEXT NOT NULL
);

-- =============================================================================
-- 2. CREATE INDEXES FOR BETTER PERFORMANCE
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_nombre ON members(nombre);
CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(email_registro);
CREATE INDEX IF NOT EXISTS idx_payments_fecha ON payments(fecha DESC);

-- =============================================================================
-- 3. ENABLE ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. CREATE SECURITY POLICIES
-- =============================================================================

-- Members Policies
-- All authenticated users can view all members
DROP POLICY IF EXISTS "Members are viewable by authenticated users" ON members;
CREATE POLICY "Members are viewable by authenticated users"
  ON members
  FOR SELECT
  TO authenticated
  USING (true);

-- Only authenticated users can insert members (for admin features later)
DROP POLICY IF EXISTS "Authenticated users can insert members" ON members;
CREATE POLICY "Authenticated users can insert members"
  ON members
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Payments Policies
-- Users can only view their own payments
DROP POLICY IF EXISTS "Users can view own payments" ON payments;
CREATE POLICY "Users can view own payments"
  ON payments
  FOR SELECT
  TO authenticated
  USING (auth.email() = email_registro);

-- Users can only insert their own payments
DROP POLICY IF EXISTS "Users can insert own payments" ON payments;
CREATE POLICY "Users can insert own payments"
  ON payments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = email_registro);

-- Users can only update their own payments
DROP POLICY IF EXISTS "Users can update own payments" ON payments;
CREATE POLICY "Users can update own payments"
  ON payments
  FOR UPDATE
  TO authenticated
  USING (auth.email() = email_registro)
  WITH CHECK (auth.email() = email_registro);

-- Users can only delete their own payments
DROP POLICY IF EXISTS "Users can delete own payments" ON payments;
CREATE POLICY "Users can delete own payments"
  ON payments
  FOR DELETE
  TO authenticated
  USING (auth.email() = email_registro);

-- =============================================================================
-- 5. SAMPLE DATA (OPTIONAL - REMOVE IF NOT NEEDED)
-- =============================================================================

-- Uncomment the lines below to insert sample data for testing

-- INSERT INTO members (nombre, apellido, apodo, email, telefono, tipo_sangre, puesto, marca_moto, modelo, placa) VALUES
-- ('Jorge', 'Guevara', 'Chicoma', 'chicoma.h616@gmail.com', '979541786', 'O+', 'Presidente', 'Harley Davidson', 'Dyna Wide Glide', 'D0304'),
-- ('Diego', 'Sánchez García', 'Spark', 'spark.h616@gmail.com', '936958794', 'A+', 'Miembro', 'Harley Davidson', 'Forty-Eight', 'A1234'),
-- ('Eduardo', 'Sesarego Izquierdo', '', 'edrups.h616@gmail.com', '944432129', 'A+', 'Congelado', 'Bajaj', 'Avenger', 'A6-3706');

-- INSERT INTO payments (fecha, monto, mes_pagado, email_registro, tipo_ingreso, comentario) VALUES
-- (NOW(), 200, 'Enero', 'chicoma.h616@gmail.com', 'Cuota', 'Cuota enero 2025'),
-- (NOW(), 200, 'Enero', 'spark.h616@gmail.com', 'Cuota', 'Cuota mensual');

-- =============================================================================
-- SETUP COMPLETE!
-- =============================================================================

-- Next steps:
-- 1. Create a Storage bucket named 'payments' and make it public
-- 2. Configure your .env file with the Supabase URL and anon key
-- 3. Start the React app with 'npm start'

SELECT 'Database setup complete! ✓' as status;

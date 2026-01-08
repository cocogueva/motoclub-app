import React, { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { supabase } from "../supabaseClient";
import "./Layout.css";

function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <div className="layout">
      <header className="header">
        <div className="header-content">
          <div className="logo-container">
            <img
              src="/logo.png"
              alt="Club Logo"
              className="header-logo"
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
            <h1 className="logo">H616</h1>
          </div>
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </header>

      <nav className={`nav ${menuOpen ? "nav-open" : ""}`}>
        <NavLink to="/" className="nav-link" onClick={closeMenu}>
          <span className="nav-icon">🏍️</span>
          Inicio
        </NavLink>
        <NavLink to="/my-dues" className="nav-link" onClick={closeMenu}>
          <span className="nav-icon">📋</span>
          Mis Cuotas
        </NavLink>
        <NavLink to="/members" className="nav-link" onClick={closeMenu}>
          <span className="nav-icon">👥</span>
          Miembros
        </NavLink>
        <NavLink to="/all-payments" className="nav-link" onClick={closeMenu}>
          <span className="nav-icon">📊</span>
          Estado Pagos
        </NavLink>
        <NavLink to="/payments" className="nav-link" onClick={closeMenu}>
          <span className="nav-icon">💰</span>
          Mis Pagos
        </NavLink>
        <NavLink to="/profile" className="nav-link" onClick={closeMenu}>
          <span className="nav-icon">👤</span>
          Perfil
        </NavLink>
        <button className="nav-link logout-btn" onClick={handleLogout}>
          <span className="nav-icon">🚪</span>
          Salir
        </button>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>

      {menuOpen && (
        <div
          className="nav-overlay"
          onClick={closeMenu}
          aria-hidden="true"
        ></div>
      )}
    </div>
  );
}

export default Layout;

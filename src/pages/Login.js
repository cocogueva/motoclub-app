import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setMessage("");

      const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;

      setMessage(
        "¡Revisa tu email! Te hemos enviado un enlace mágico para iniciar sesión."
      );
    } catch (error) {
      setMessage(
        error.message || "Error al enviar el enlace. Intenta de nuevo."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="road-line"></div>
        <div className="road-line"></div>
        <div className="road-line"></div>
      </div>

      <div className="login-card fade-in">
        <div className="login-header">
          {/* Add your logo image here */}
          <div className="club-logo-container">
            <img
              src="/logo.png"
              alt="H616 Logo"
              className="club-logo"
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
          </div>
          <h1 className="login-logo">H616</h1>
          <p className="login-subtitle">Motorcycle Club</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="form-input"
            />
          </div>

          <button type="submit" className="btn btn-login" disabled={loading}>
            {loading ? "Enviando..." : "Enviar Link de Acceso"}
          </button>

          {message && (
            <div
              className={`message ${
                message.includes("Error") ? "message-error" : "message-success"
              }`}
            >
              {message}
            </div>
          )}
        </form>

        <div className="login-info">
          <p>
            Ingresa tu email y te enviaremos un enlace para iniciar sesión. No
            necesitas contraseña.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;

import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import "./Payments.css";

function Payments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    monto: "100",
    concepto_pago: "Otro pago",
    comentario: "",
    payment_type: "otro_concepto",
  });
  const [voucherFile, setVoucherFile] = useState(null);
  const [message, setMessage] = useState("");
  const cameraInputRef = React.useRef(null);
  const galleryInputRef = React.useRef(null);

  useEffect(() => {
    loadPayments();
  }, []);

  const loadPayments = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("email_registro", user.email)
        .order("fecha", { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error("Error loading payments:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVoucherFile(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!voucherFile) {
      setMessage("Por favor selecciona un comprobante");
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: memberData, error: memberError } = await supabase
        .from("members")
        .select("id")
        .eq("email", user.email)
        .single();

      if (memberError || !memberData) {
        throw new Error("Usuario no encontrado en la tabla de miembros");
      }

      const fileExt = voucherFile.name.split(".").pop();
      const fileName = `${user.id}_${Date.now()}.${fileExt}`;
      const filePath = `vouchers/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("payments")
        .upload(filePath, voucherFile);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("payments").getPublicUrl(filePath);

      const { error: insertError } = await supabase.from("payments").insert([
        {
          member_id: memberData.id,
          fecha: new Date().toISOString(),
          monto: parseInt(formData.monto),
          concepto_pago: formData.concepto_pago,
          voucher: publicUrl,
          email_registro: user.email,
          comentario: formData.comentario,
          payment_type: "otro_concepto",
          tipo_ingreso: "Otro",
        },
      ]);

      if (insertError) throw insertError;

      setMessage("¡Pago registrado exitosamente!");
      setFormData({
        monto: "100",
        concepto_pago: "Otro pago",
        comentario: "",
        payment_type: "otro_concepto",
      });
      setVoucherFile(null);
      setShowForm(false);
      loadPayments();
    } catch (error) {
      console.error("Error submitting payment:", error);
      setMessage(
        error.message || "Error al registrar el pago. Intenta de nuevo."
      );
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="payments-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="payments-page">
      <div className="payments-header">
        <div>
          <h1 className="page-title">Mis Pagos</h1>
          <p className="page-subtitle">
            {payments.length}{" "}
            {payments.length === 1 ? "pago registrado" : "pagos registrados"}
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancelar" : "+ Nuevo Pago"}
        </button>
      </div>

      {showForm && (
        <div className="payment-form-container fade-in">
          <form onSubmit={handleSubmit} className="payment-form">
            <h3>Registrar Pago</h3>

            <div className="form-group">
              <label htmlFor="concepto_pago">Concepto del Pago</label>
              <select
                id="concepto_pago"
                value={formData.concepto_pago}
                onChange={(e) =>
                  setFormData({ ...formData, concepto_pago: e.target.value })
                }
                required
              >
                <option value="Otro pago">Otro pago</option>
                <option value="Mora">Mora</option>
                <option value="Multa">Multa</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="monto">Monto (S/.)</label>
              <input
                id="monto"
                type="number"
                value={formData.monto}
                onChange={(e) =>
                  setFormData({ ...formData, monto: e.target.value })
                }
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="comentario">Comentario (opcional)</label>
              <textarea
                id="comentario"
                rows="3"
                placeholder="Agrega un comentario..."
                value={formData.comentario}
                onChange={(e) =>
                  setFormData({ ...formData, comentario: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>
                Comprobante{" "}
                {!voucherFile && <span style={{ color: "#e74c3c" }}>*</span>}
              </label>
              <div className="upload-buttons">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  📷 Tomar Foto
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  🖼️ Subir Imagen
                </button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              {voucherFile && (
                <p className="file-name" style={{ color: "#2ecc71" }}>
                  ✅ {voucherFile.name}
                </p>
              )}
            </div>

            <button type="submit" className="btn" disabled={uploading}>
              {uploading ? "Subiendo..." : "Registrar Pago"}
            </button>

            {message && (
              <div
                className={`message ${
                  message.includes("Error") || message.includes("Por favor")
                    ? "message-warning"
                    : "message-success"
                }`}
              >
                {message}
              </div>
            )}
          </form>
        </div>
      )}

      {payments.length === 0 ? (
        <div className="no-results">
          <p>No tienes pagos registrados aún.</p>
          <button className="btn-secondary" onClick={() => setShowForm(true)}>
            Registrar primer pago
          </button>
        </div>
      ) : (
        <div className="payments-list">
          {payments.map((payment, index) => (
            <div
              key={payment.id}
              className="payment-card fade-in"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="payment-header-card">
                <div>
                  <h3 className="payment-month">
                    {payment.payment_type === "otro_concepto"
                      ? payment.concepto_pago || payment.mes_pagado
                      : payment.mes_pagado}
                  </h3>
                  <p className="payment-date">
                    {new Date(payment.fecha).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                  {payment.payment_type && (
                    <span
                      className={`payment-type-badge ${payment.payment_type}`}
                    >
                      {payment.payment_type === "cuota_mensual"
                        ? "💳 Cuota"
                        : payment.payment_type === "pago_adelantado"
                        ? "⚡ Adelantado"
                        : "📌 Otro"}
                    </span>
                  )}
                </div>
                <div className="payment-amount">S/. {payment.monto}</div>
              </div>

              {payment.comentario && (
                <p className="payment-comment">{payment.comentario}</p>
              )}

              {payment.voucher && (
                <a
                  href={payment.voucher}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="payment-voucher-link"
                >
                  📎 Ver comprobante
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Payments;

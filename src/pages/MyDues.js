import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import "./MyDues.css";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function MyDues() {
  const [dues, setDues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);
  const [statusFilter, setStatusFilter] = useState(["overdue", "pending"]);
  const [selectedDue, setSelectedDue] = useState(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voucherFile, setVoucherFile] = useState(null);
  const [message, setMessage] = useState("");
  const cameraInputRef = React.useRef(null);
  const galleryInputRef = React.useRef(null);

  useEffect(() => {
    loadDues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  const toggleStatusFilter = (status) => {
    setStatusFilter((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      } else {
        return [...prev, status];
      }
    });
  };

  const filteredDues =
    statusFilter.length > 0
      ? dues.filter((due) => statusFilter.includes(due.status))
      : dues;

  const loadDues = async () => {
    try {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: memberData } = await supabase
        .from("members")
        .select("id")
        .eq("email", user.email)
        .single();

      if (!memberData) {
        setLoading(false);
        return;
      }

      const { data: duesData, error } = await supabase
        .from("monthly_dues")
        .select("*")
        .eq("member_id", memberData.id)
        .eq("year", selectedYear)
        .order("month");

      if (error) throw error;

      const { data: yearsData } = await supabase
        .from("monthly_dues")
        .select("year")
        .eq("member_id", memberData.id);

      const years = [...new Set(yearsData?.map((d) => d.year) || [])].sort(
        (a, b) => b - a
      );

      setDues(duesData || []);
      setAvailableYears(years);
    } catch (error) {
      console.error("Error loading dues:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePayDue = (due) => {
    setSelectedDue(due);
    setShowPaymentForm(true);
    setMessage("");
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVoucherFile(file);
    }
  };

  const handleSubmitPayment = async (e) => {
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

      const { data: memberData } = await supabase
        .from("members")
        .select("id")
        .eq("email", user.email)
        .single();

      if (!memberData) throw new Error("Miembro no encontrado");

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

      const { data: paymentData, error: paymentError } = await supabase
        .from("payments")
        .insert([
          {
            member_id: memberData.id,
            fecha: new Date().toISOString(),
            monto: selectedDue.amount,
            mes_pagado: MONTHS[selectedDue.month - 1],
            voucher: publicUrl,
            email_registro: user.email,
            comentario: `Cuota ${MONTHS[selectedDue.month - 1]} ${
              selectedDue.year
            }`,
            tipo_ingreso: "Cuota",
            payment_type: "cuota_mensual",
            applies_to_year: selectedDue.year,
            applies_to_month: selectedDue.month,
          },
        ])
        .select()
        .single();

      if (paymentError) throw paymentError;

      const { data: updateData, error: updateError } = await supabase
        .from("monthly_dues")
        .update({
          status: "paid",
          paid_date: new Date().toISOString(),
          payment_id: paymentData.id,
        })
        .eq("id", selectedDue.id)
        .select();

      if (updateError) throw updateError;

      setMessage("¡Pago registrado exitosamente!");
      setVoucherFile(null);
      setShowPaymentForm(false);
      setSelectedDue(null);

      await loadDues();
    } catch (error) {
      console.error("Error submitting payment:", error);
      setMessage("Error al registrar el pago: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  const getStatusInfo = (due) => {
    const today = new Date();
    const dueDate = new Date(due.due_date);
    const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

    if (due.status === "paid") {
      return { text: "Pagado", className: "status-paid", icon: "✅" };
    } else if (due.status === "overdue") {
      return {
        text: `Vencido (${Math.abs(daysUntilDue)} días)`,
        className: "status-overdue",
        icon: "🔴",
      };
    } else if (daysUntilDue <= 15 && daysUntilDue > 0) {
      return {
        text: `Próximo vencimiento (${daysUntilDue} días)`,
        className: "status-due-soon",
        icon: "🟡",
      };
    } else {
      return { text: "Pendiente", className: "status-pending", icon: "⚪" };
    }
  };

  const totalDue = dues
    .filter((d) => d.status !== "paid")
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const totalPaid = dues
    .filter((d) => d.status === "paid")
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);

  if (loading) {
    return (
      <div className="my-dues-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="my-dues-page">
      <div className="my-dues-header">
        <div>
          <h1 className="page-title">Mis Cuotas</h1>
          <p className="page-subtitle">Año {selectedYear}</p>
        </div>

        <div className="year-selector">
          <label htmlFor="year-select">Año:</label>
          <select
            id="year-select"
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="dues-summary">
        <div className="summary-card">
          <span className="summary-label">Total Pagado</span>
          <span className="summary-value paid">S/. {totalPaid.toFixed(2)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total Pendiente</span>
          <span className="summary-value pending">
            S/. {totalDue.toFixed(2)}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Cuotas</span>
          <span className="summary-value">
            {dues.filter((d) => d.status === "paid").length} / {dues.length}
          </span>
        </div>
      </div>

      <div className="status-filters">
        <span className="filter-label">Filtrar por estado:</span>
        <button
          className={`filter-chip ${
            statusFilter.includes("overdue") ? "active overdue" : ""
          }`}
          onClick={() => toggleStatusFilter("overdue")}
        >
          🔴 Vencido ({dues.filter((d) => d.status === "overdue").length})
        </button>
        <button
          className={`filter-chip ${
            statusFilter.includes("pending") ? "active pending" : ""
          }`}
          onClick={() => toggleStatusFilter("pending")}
        >
          ⚪ Pendiente ({dues.filter((d) => d.status === "pending").length})
        </button>
        <button
          className={`filter-chip ${
            statusFilter.includes("paid") ? "active paid" : ""
          }`}
          onClick={() => toggleStatusFilter("paid")}
        >
          ✅ Pagado ({dues.filter((d) => d.status === "paid").length})
        </button>
        {statusFilter.length !== 3 && (
          <button
            className="filter-chip reset"
            onClick={() => setStatusFilter(["paid", "pending", "overdue"])}
          >
            Todos
          </button>
        )}
      </div>

      {message && (
        <div
          className={`message ${
            message.includes("Error") ? "message-error" : "message-success"
          }`}
        >
          {message}
        </div>
      )}

      {showPaymentForm && selectedDue && (
        <div
          className="payment-modal-overlay"
          onClick={() => setShowPaymentForm(false)}
        >
          <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Pagar Cuota</h3>
            <p className="modal-subtitle">
              {MONTHS[selectedDue.month - 1]} {selectedDue.year} - S/.{" "}
              {selectedDue.amount}
            </p>

            <form onSubmit={handleSubmitPayment}>
              <div className="form-group">
                <label>Comprobante de Pago</label>
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
                {voucherFile && <p className="file-name">{voucherFile.name}</p>}
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn" disabled={uploading}>
                  {uploading ? "Subiendo..." : "Registrar Pago"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowPaymentForm(false)}
                  disabled={uploading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="dues-grid">
        {filteredDues.map((due, index) => {
          const statusInfo = getStatusInfo(due);
          return (
            <div
              key={due.id}
              className={`due-card ${statusInfo.className} fade-in`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="due-header">
                <div className="due-month">
                  <span className="month-name">{MONTHS[due.month - 1]}</span>
                  <span className="month-year">{due.year}</span>
                </div>
                <div className="due-amount">S/. {due.amount}</div>
              </div>

              <div className="due-info">
                <div className="info-row">
                  <span className="info-label">Vence:</span>
                  <span className="info-value">
                    {new Date(due.due_date).toLocaleDateString("es-PE", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <div className="info-row">
                  <span className="info-label">Estado:</span>
                  <span className={`status-badge ${statusInfo.className}`}>
                    {statusInfo.icon} {statusInfo.text}
                  </span>
                </div>

                {due.status === "paid" && due.paid_date && (
                  <div className="info-row">
                    <span className="info-label">Pagado:</span>
                    <span className="info-value">
                      {new Date(due.paid_date).toLocaleDateString("es-PE")}
                    </span>
                  </div>
                )}
              </div>

              {due.status !== "paid" && (
                <button
                  className="btn btn-pay"
                  onClick={() => handlePayDue(due)}
                >
                  💳 Pagar Cuota
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MyDues;

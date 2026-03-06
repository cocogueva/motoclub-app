import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import "./MyDebts.css";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const DAILY_MORA_RATE = 1.5;

const computeMoraDays = (due) => {
  if (due.is_frozen) return 0;

  const dueDate = new Date(due.due_date);
  const moraStart = new Date(dueDate);
  moraStart.setDate(moraStart.getDate() + 1);
  moraStart.setHours(0, 0, 0, 0);

  const endDate = due.paid_date ? new Date(due.paid_date) : new Date();
  endDate.setHours(0, 0, 0, 0);

  return Math.max(0, Math.floor((endDate - moraStart) / (1000 * 60 * 60 * 24)));
};

function MyDebts() {
  const [loading, setLoading] = useState(true);
  const [customDebts, setCustomDebts] = useState([]);
  const [moraDebt, setMoraDebt] = useState(null);
  const [moraBreakdown, setMoraBreakdown] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [voucherFile, setVoucherFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const cameraInputRef = React.useRef(null);
  const galleryInputRef = React.useRef(null);

  useEffect(() => {
    loadDebts();
  }, []);

  const loadDebts = async () => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();

      const { data: memberData } = await supabase
        .from("members")
        .select("id")
        .eq("email", user.email)
        .single();

      if (!memberData) {
        setLoading(false);
        return;
      }

      // Load all debts
      const { data: debtsData, error: debtsError } = await supabase
        .from("member_debts")
        .select("*")
        .eq("member_id", memberData.id)
        .order("created_at", { ascending: false });

      if (debtsError) throw debtsError;

      const mora = debtsData?.find((d) => d.debt_type === "mora") || null;
      const custom = debtsData?.filter((d) => d.debt_type === "custom") || [];

      // Load dues that ever generated mora (overdue or paid late)
      const { data: allDues } = await supabase
        .from("monthly_dues")
        .select("*")
        .eq("member_id", memberData.id)
        .or("status.eq.overdue,status.eq.paid")
        .order("year", { ascending: true })
        .order("month", { ascending: true });

      const moraDues = (allDues || []).filter((due) => {
        if (due.is_frozen) return false;
        if (due.status === "overdue") return true;
        if (due.status === "paid" && due.paid_date) {
          return new Date(due.paid_date) > new Date(due.due_date);
        }
        return false;
      });

      const breakdown = moraDues
        .map((due) => ({
          month: MONTHS[due.month - 1],
          year: due.year,
          days: computeMoraDays(due),
          amount: computeMoraDays(due) * DAILY_MORA_RATE,
          isAccruing: due.status === "overdue",
        }))
        .filter((b) => b.days > 0);

      const totalMora = breakdown.reduce((sum, b) => sum + b.amount, 0);

      // Auto-create mora record if mora exists but no record yet
      if (breakdown.length > 0 && !mora) {
        const { data: newMora } = await supabase
          .from("member_debts")
          .insert([{
            member_id: memberData.id,
            debt_type: "mora",
            total_paid: 0,
            status: "pending",
          }])
          .select()
          .single();

        setMoraDebt({ ...newMora, computedTotal: totalMora });
      } else if (mora) {
        const moraBalance = totalMora - (mora.total_paid || 0);
        if (moraBalance <= 0 && mora.status !== "paid") {
          await supabase
            .from("member_debts")
            .update({ status: "paid" })
            .eq("id", mora.id);
          setMoraDebt({ ...mora, status: "paid", computedTotal: totalMora });
        } else {
          setMoraDebt({ ...mora, computedTotal: totalMora });
        }
      }

      setMoraBreakdown(breakdown);
      setCustomDebts(custom);
    } catch (error) {
      console.error("Error loading debts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePayDebt = (debt) => {
    setSelectedDebt(debt);
    setPayAmount("");
    setVoucherFile(null);
    setMessage("");
    setShowPaymentModal(true);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) setVoucherFile(file);
  };

  const getBalance = (debt) => {
    if (debt.isMora) {
      return Math.max(0, (debt.computedTotal || 0) - (debt.total_paid || 0));
    }
    return Math.max(0, (debt.amount || 0) - (debt.total_paid || 0));
  };

  const handleSubmitPayment = async (e) => {
    e.preventDefault();

    if (!voucherFile) {
      setMessage("Por favor selecciona un comprobante");
      return;
    }

    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      setMessage("Ingresa un monto válido");
      return;
    }

    const balance = getBalance(selectedDebt);
    if (amount > balance) {
      setMessage(`El monto no puede superar el saldo (S/. ${balance.toFixed(2)})`);
      return;
    }

    try {
      setUploading(true);
      setMessage("");

      const { data: { user } } = await supabase.auth.getUser();

      const { data: memberData } = await supabase
        .from("members")
        .select("id")
        .eq("email", user.email)
        .single();

      const fileExt = voucherFile.name.split(".").pop();
      const fileName = `${user.id}_${Date.now()}.${fileExt}`;
      const filePath = `vouchers/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("payments")
        .upload(filePath, voucherFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("payments")
        .getPublicUrl(filePath);

      const { error: paymentError } = await supabase
        .from("payments")
        .insert([{
          member_id: memberData.id,
          email_registro: user.email,
          fecha: new Date().toISOString(),
          monto: amount,
          payment_type: selectedDebt.isMora ? "mora" : "deuda",
          concept: selectedDebt.isMora ? "Mora" : selectedDebt.description,
          voucher: publicUrl,
          debt_id: selectedDebt.id,
          comentario: selectedDebt.isMora
            ? "Pago de mora"
            : `Pago deuda: ${selectedDebt.description}`,
        }]);

      if (paymentError) throw paymentError;

      const newTotalPaid = (selectedDebt.total_paid || 0) + amount;
      const newBalance = selectedDebt.isMora
        ? (selectedDebt.computedTotal || 0) - newTotalPaid
        : (selectedDebt.amount || 0) - newTotalPaid;

      const { error: updateError } = await supabase
        .from("member_debts")
        .update({
          total_paid: newTotalPaid,
          status: newBalance <= 0 ? "paid" : "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedDebt.id);

      if (updateError) throw updateError;

      setMessage("¡Pago registrado exitosamente!");
      setShowPaymentModal(false);
      setSelectedDebt(null);
      await loadDebts();
    } catch (error) {
      console.error("Error submitting payment:", error);
      setMessage("Error al registrar el pago: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  const moraBalance = moraDebt
    ? Math.max(0, (moraDebt.computedTotal || 0) - (moraDebt.total_paid || 0))
    : 0;

  const showMoraCard =
    moraDebt &&
    moraBreakdown.length > 0 &&
    (filter === "all" || moraDebt.status === filter);

  const filteredCustomDebts =
    filter === "all" ? customDebts : customDebts.filter((d) => d.status === filter);

  if (loading) {
    return (
      <div className="debts-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="debts-page">
      <div className="debts-header">
        <h1 className="page-title">Mis Deudas</h1>
      </div>

      <div className="debts-filters">
        {[
          { key: "pending", label: "Pendiente" },
          { key: "paid", label: "Pagado" },
          { key: "all", label: "Todos" },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`filter-chip ${filter === key ? `active ${key}` : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Mora Card */}
      {showMoraCard && (
        <div className={`debt-card mora-card ${moraDebt.status}`}>
          <div className="debt-card-header">
            <div>
              <h3 className="debt-title">Mora</h3>
              <p className="debt-subtitle">
                S/. {DAILY_MORA_RATE} por día de retraso
              </p>
            </div>
            <span className={`debt-status-badge ${moraDebt.status}`}>
              {moraDebt.status === "paid" ? "Pagado" : "Pendiente"}
            </span>
          </div>

          <div className="mora-breakdown">
            {moraBreakdown.map((b, i) => (
              <div key={i} className="mora-month-row">
                <span className="mora-month-label">
                  {b.month} {b.year}
                  {b.isAccruing && (
                    <span className="accruing-badge">acumulando</span>
                  )}
                </span>
                <span className="mora-month-amount">
                  S/. {b.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="debt-totals">
            <div className="debt-total-row">
              <span>Total mora</span>
              <span>S/. {(moraDebt.computedTotal || 0).toFixed(2)}</span>
            </div>
            <div className="debt-total-row paid-row">
              <span>Pagado</span>
              <span>S/. {(moraDebt.total_paid || 0).toFixed(2)}</span>
            </div>
            <div className="debt-total-row balance-row">
              <span>Saldo</span>
              <span>S/. {moraBalance.toFixed(2)}</span>
            </div>
          </div>

          {moraDebt.status === "pending" && (
            <button
              className="btn btn-pay"
              onClick={() => handlePayDebt({ ...moraDebt, isMora: true })}
            >
              Pagar Mora
            </button>
          )}
        </div>
      )}

      {/* Custom Debt Cards */}
      {filteredCustomDebts.map((debt, index) => {
        const balance = debt.amount - (debt.total_paid || 0);
        return (
          <div
            key={debt.id}
            className={`debt-card fade-in ${debt.status}`}
            style={{ animationDelay: `${index * 0.05}s` }}
          >
            <div className="debt-card-header">
              <h3 className="debt-title">{debt.description}</h3>
              <span className={`debt-status-badge ${debt.status}`}>
                {debt.status === "paid" ? "Pagado" : "Pendiente"}
              </span>
            </div>

            {debt.notes && <p className="debt-notes">{debt.notes}</p>}

            <div className="debt-totals">
              <div className="debt-total-row">
                <span>Total</span>
                <span>S/. {parseFloat(debt.amount).toFixed(2)}</span>
              </div>
              <div className="debt-total-row paid-row">
                <span>Pagado</span>
                <span>S/. {parseFloat(debt.total_paid || 0).toFixed(2)}</span>
              </div>
              <div className="debt-total-row balance-row">
                <span>Saldo</span>
                <span>S/. {balance.toFixed(2)}</span>
              </div>
            </div>

            {debt.status === "pending" && (
              <button
                className="btn btn-pay"
                onClick={() => handlePayDebt(debt)}
              >
                Pagar
              </button>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {!showMoraCard && filteredCustomDebts.length === 0 && (
        <div className="no-results">
          <p>
            {filter === "paid"
              ? "No tienes deudas pagadas."
              : "No tienes deudas pendientes."}
          </p>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedDebt && (
        <div
          className="payment-modal-overlay"
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            className="payment-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Registrar Pago</h3>
            <p className="modal-subtitle">
              {selectedDebt.isMora ? "Mora" : selectedDebt.description}
            </p>
            <p className="modal-balance">
              Saldo: S/. {getBalance(selectedDebt).toFixed(2)}
            </p>

            {message && (
              <div
                className={`message ${
                  message.includes("Error") ||
                  message.includes("Por favor") ||
                  message.includes("no puede")
                    ? "message-warning"
                    : "message-success"
                }`}
              >
                {message}
              </div>
            )}

            <form onSubmit={handleSubmitPayment}>
              <div className="form-group">
                <label htmlFor="pay-amount">Monto a pagar (S/.)</label>
                <input
                  id="pay-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  required
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

              <div className="modal-actions">
                <button type="submit" className="btn" disabled={uploading}>
                  {uploading ? "Subiendo..." : "Registrar Pago"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowPaymentModal(false)}
                  disabled={uploading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default MyDebts;

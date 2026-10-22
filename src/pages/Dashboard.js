import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

// Andrés' NotebookLM notebook with all the actas de asamblea (opens outside the app;
// members need the notebook shared with them / "anyone with the link")
const ACTAS_NOTEBOOK_URL =
  "https://notebook.google.com/notebook/059de656-6053-4eb4-b9b0-86a2aaebdba0";

// Helper function to parse date string as local date (not UTC)
const parseLocalDate = (dateString) => {
  if (!dateString) return null;
  if (dateString instanceof Date) return dateString;

  const dateMatch = dateString.toString().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch.map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(dateString);
};

function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalMembers: 0,
    myOverdueDues: 0,
    nextDueDate: null,
    totalCollectedYear: 0,
  });
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [memberPhoto, setMemberPhoto] = useState(null);
  const [memberNickname, setMemberNickname] = useState(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);

      const currentYear = new Date().getFullYear();

      // Get total members (exclude retired; keep null-puesto rows counted)
      const { count: membersCount } = await supabase
        .from("members")
        .select("*", { count: "exact", head: true })
        .or("puesto.is.null,puesto.neq.Retirado");

      // Get total collected this year (only cuotas)
      // Use applies_to_month and applies_to_year to identify cuotas
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("monto, payment_type, applies_to_month, applies_to_year")
        .gte("fecha", `${currentYear}-01-01`)
        .lte("fecha", `${currentYear}-12-31`);

      // Only sum payments that are explicitly cuota_mensual OR have applies_to_month/year set
      const totalCollected =
        paymentsData?.reduce((sum, p) => {
          const isCuota =
            p.payment_type === "cuota_mensual" ||
            (p.applies_to_month && p.applies_to_year === currentYear);
          return isCuota ? sum + (p.monto || 0) : sum;
        }, 0) || 0;

      // Get member's dues
      const { data: memberData } = await supabase
        .from("members")
        .select("id, foto, apodo, nombre")
        .eq("email", user.email)
        .single();

      if (memberData?.foto) setMemberPhoto(memberData.foto);
      if (memberData?.apodo || memberData?.nombre)
        setMemberNickname(memberData.apodo || memberData.nombre);

      let myOverdueDues = 0;
      let nextDueDate = null;

      if (memberData) {
        // Freezing is done in the DB (trigger on puesto change + daily cron)
        // Get overdue dues that are NOT frozen
        const { data: overdueDues } = await supabase
          .from("monthly_dues")
          .select("*")
          .eq("member_id", memberData.id)
          .eq("status", "overdue")
          .or("is_frozen.is.null,is_frozen.eq.false");

        myOverdueDues = overdueDues?.length || 0;

        // Get next pending due that is NOT frozen
        const { data: nextDue } = await supabase
          .from("monthly_dues")
          .select("due_date")
          .eq("member_id", memberData.id)
          .in("status", ["pending", "overdue"])
          .or("is_frozen.is.null,is_frozen.eq.false")
          .order("due_date", { ascending: true })
          .limit(1)
          .single();

        if (nextDue) {
          nextDueDate = nextDue.due_date;
        }
      }

      setStats({
        totalMembers: membersCount || 0,
        myOverdueDues: myOverdueDues,
        nextDueDate: nextDueDate,
        totalCollectedYear: totalCollected,
      });
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-welcome-row">
          {memberPhoto && (
            <img src={memberPhoto} alt="avatar" className="dashboard-avatar" />
          )}
          <div>
            <p className="dashboard-welcome">
              Bienvenido, <span className="text-spark">{memberNickname}</span>
            </p>
            <p className="dashboard-welcome-email">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div
          className={`stat-card fade-in${stats.myOverdueDues >= 3 ? " stat-card--arrest" : ""}`}
          style={{ animationDelay: "0.2s" }}
          onClick={() => navigate("/my-dues")}
        >
          <div className="stat-icon">💸</div>
          <div className="stat-content">
            <h3 className="stat-value">{stats.myOverdueDues}</h3>
            <p className="stat-label">Cuotas Vencidas</p>
            {stats.myOverdueDues >= 3 && (
              <p className="stat-arrest-badge">⚠️ Arresto de colores ☠️</p>
            )}
            {stats.nextDueDate && (
              <p className="stat-sublabel">
                Próxima:{" "}
                {parseLocalDate(stats.nextDueDate).toLocaleDateString("es-PE", {
                  day: "numeric",
                  month: "short",
                })}
              </p>
            )}
          </div>
          <button className="stat-link">
            <b>
              Pago de cuotas <br></br> Listado de cuotas
            </b>
          </button>
        </div>

        <div
          className="stat-card fade-in"
          style={{ animationDelay: "0.3s" }}
          onClick={() => navigate("/all-payments")}
        >
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3 className="stat-value">
              S/. {stats.totalCollectedYear.toLocaleString()}
            </h3>
            <p className="stat-label">Cuotas Recaudadas</p>
          </div>
          <button className="stat-link">
            <b>Historial de recaudación</b>
          </button>
        </div>

        <div
          className="stat-card fade-in"
          style={{ animationDelay: "0.1s" }}
          onClick={() => navigate("/members")}
        >
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3 className="stat-value">{stats.totalMembers}</h3>
            <p className="stat-label">Total Miembros</p>
          </div>
          <button className="stat-link">
            <b>Ver lista</b>
          </button>
        </div>
      </div>

      <div
        className="dashboard-actions fade-in"
        style={{ animationDelay: "0.4s" }}
      >
        <h2 className="section-title">Acciones Rápidas</h2>
        <div className="actions-grid">
          <button className="action-card" onClick={() => navigate("/payments")}>
            <span className="action-icon">🧾</span>
            <span className="action-label">Otros Pagos</span>
          </button>

          <button className="action-card" onClick={() => navigate("/my-debts")}>
            {stats.myOverdueDues > 0 && <span className="action-alert-dot" />}
            <span className="action-icon">💀</span>
            <span className="action-label">Ver Deudas</span>
          </button>

          <button className="action-card" onClick={() => navigate("/profile")}>
            <span className="action-icon">⚙️</span>
            <span className="action-label">Mi Perfil</span>
          </button>

          <a
            className="action-card"
            href={ACTAS_NOTEBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="action-icon">📜</span>
            <span className="action-label">IA Actas ↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;

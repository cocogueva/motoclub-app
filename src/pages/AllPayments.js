import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import "./AllPayments.css";

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

function AllPayments() {
  const [members, setMembers] = useState([]);
  const [dues, setDues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [availableYears, setAvailableYears] = useState([]);
  const [voucherModal, setVoucherModal] = useState(null); // { memberName, month, voucherUrl }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load all members
      const { data: membersData, error: membersError } = await supabase
        .from("members")
        .select("id, nombre, apellido, email, puesto")
        .order("nombre");

      if (membersError) throw membersError;

      // Dues of the selected year with their display status, computed in SQL
      // (dues_status view: paid / retired / frozen / overdue / due-soon / pending)
      const { data: duesData, error: duesError } = await supabase
        .from("dues_status")
        .select("member_id, month, amount, paid_amount, voucher, display_status")
        .eq("year", selectedYear);

      if (duesError) throw duesError;

      // Available years = years that have dues
      const { data: yearsData } = await supabase
        .from("monthly_dues")
        .select("year");

      const years = [...new Set((yearsData || []).map((d) => d.year))].sort(
        (a, b) => b - a
      );

      setMembers(membersData || []);
      setDues(duesData || []);
      setAvailableYears(years);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const isRetired = (member) => member.puesto?.toLowerCase() === "retirado";

  const getDue = (member, month) => {
    const monthIndex = MONTHS.indexOf(month) + 1; // 1-12
    return dues.find((d) => d.member_id === member.id && d.month === monthIndex);
  };

  // A month with no due row: retired members (no dues after leaving) show as
  // retired, anyone else as "none" (no cuota that month)
  const getMonthStatus = (member, month) =>
    getDue(member, month)?.display_status || (isRetired(member) ? "retired" : "none");

  const filteredMembers = members.map((member) => {
    const paidDues = dues.filter(
      (d) => d.member_id === member.id && d.display_status === "paid"
    );
    const totalPaid = paidDues.reduce(
      (sum, d) => sum + Number(d.paid_amount ?? d.amount ?? 0),
      0
    );

    if (selectedMonth === "all") {
      return { ...member, totalPaid, paymentsCount: paidDues.length };
    }
    const status = getMonthStatus(member, selectedMonth);
    return {
      ...member,
      totalPaid,
      monthStatus: status,
      paidThisMonth: status === "paid",
      frozen: status === "frozen",
      // Month view hides members who weren't in the club that month
      retired: status === "retired" || status === "none",
    };
  });

  // Active member count for the header (retired members are excluded entirely)
  const activeMembers = members.filter((m) => !isRetired(m));

  // Month view: hide members already retired by the selected month
  const monthViewMembers = filteredMembers.filter((m) => !m.retired);

  // Year view: keep everyone (history), but push retired members to the bottom
  const yearViewMembers = [...filteredMembers].sort(
    (a, b) => (isRetired(a) ? 1 : 0) - (isRetired(b) ? 1 : 0)
  );

  // Header count: whole year -> active members; a specific month -> members present that month
  const headerCount =
    selectedMonth === "all" ? activeMembers.length : monthViewMembers.length;

  if (loading) {
    return (
      <div className="all-payments-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="all-payments-page">
      <div className="all-payments-header">
        <div>
          <h1 className="page-title">Estado de Pagos</h1>
          <p className="page-subtitle">
            {headerCount} {headerCount === 1 ? "miembro" : "miembros"}
          </p>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <label htmlFor="year-select">Año</label>
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

        <div className="filter-group">
          <label htmlFor="month-select">Mes</label>
          <select
            id="month-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            <option value="all">Todos los meses</option>
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedMonth === "all" ? (
        // Year View - Show total payments per member
        <div className="payments-grid">
          {yearViewMembers.map((member, index) => (
            <div
              key={member.id}
              className={`payment-status-card fade-in${isRetired(member) ? " retired" : ""}`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="member-info-row">
                <div>
                  <h3
                    className={`member-name-card${isRetired(member) ? " member-name-retired" : ""}`}
                  >
                    {member.nombre} {member.apellido}
                  </h3>
                  <p className="member-email-card">{member.email}</p>
                </div>
                <div className="payment-stats">
                  <div className="stat-item">
                    <span className="stat-number">{member.paymentsCount}</span>
                    <span className="stat-label-small">cuotas</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-number stat-money">
                      S/ {member.totalPaid}
                    </span>
                    <span className="stat-label-small">total</span>
                  </div>
                </div>
              </div>

              {/* Month indicators */}
              <div className="month-indicators">
                {MONTHS.map((month) => {
                  const status = getMonthStatus(member, month);
                  const payment = status === "paid" ? getDue(member, month) : null;
                  const hasVoucher = payment?.voucher;
                  return (
                    <div
                      key={month}
                      className={`month-indicator status-${status === "none" ? "retired" : status}${hasVoucher ? " has-voucher" : ""}`}
                      title={`${month} - ${
                        status === "paid"
                          ? hasVoucher ? "Pagado — ver voucher" : "Pagado"
                          : status === "retired"
                          ? "Retirado"
                          : status === "none"
                          ? "Sin cuota"
                          : status === "frozen"
                          ? "Congelado"
                          : status === "overdue"
                          ? "Vencido"
                          : status === "due-soon"
                          ? "Próximo vencimiento"
                          : "Pendiente"
                      }`}
                      onClick={hasVoucher ? () => setVoucherModal({
                        memberName: `${member.nombre} ${member.apellido}`,
                        month,
                        voucherUrl: payment.voucher,
                      }) : undefined}
                    >
                      {status === "paid" && "✓"}
                      {(status === "retired" || status === "none") && "—"}
                      {status === "frozen" && "❄️"}
                      {status === "overdue" && "✗"}
                      {status === "due-soon" && "!"}
                      {status === "pending" && month.substring(0, 3)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Month View - Show who paid this specific month
        <div className="payments-list-simple">
          <div className="month-summary">
            <h2>
              Pagos de {selectedMonth} {selectedYear}
            </h2>
            <p>
              {monthViewMembers.filter((m) => m.paidThisMonth).length} de{" "}
              {monthViewMembers.filter((m) => !m.frozen).length}{" "}
              miembros pagaron
              {monthViewMembers.filter((m) => m.frozen).length > 0 && (
                <span>
                  {" "}
                  ({monthViewMembers.filter((m) => m.frozen).length} congelados)
                </span>
              )}
            </p>
          </div>

          <div className="members-simple-grid">
            {monthViewMembers.map((member, index) => {
              // Determine the status class and text
              let statusClass = "pending";
              let statusText = "Pendiente";
              let statusIcon = "✗";

              if (member.monthStatus === "paid") {
                statusClass = "paid";
                statusText = "Pagado";
                statusIcon = "✓";
              } else if (member.monthStatus === "frozen") {
                statusClass = "frozen";
                statusText = "Congelado";
                statusIcon = "❄️";
              } else if (member.monthStatus === "overdue") {
                statusClass = "overdue";
                statusText = "Vencido";
                statusIcon = "✗";
              } else if (member.monthStatus === "due-soon") {
                statusClass = "due-soon";
                statusText = "Vence pronto";
                statusIcon = "!";
              }

              const monthPayment = member.paidThisMonth
                ? getDue(member, selectedMonth)
                : null;
              const monthHasVoucher = monthPayment?.voucher;

              return (
                <div
                  key={member.id}
                  className={`member-simple-card ${statusClass} fade-in${monthHasVoucher ? " has-voucher" : ""}`}
                  style={{ animationDelay: `${index * 0.03}s` }}
                  onClick={monthHasVoucher ? () => setVoucherModal({
                    memberName: `${member.nombre} ${member.apellido}`,
                    month: selectedMonth,
                    voucherUrl: monthPayment.voucher,
                  }) : undefined}
                >
                  <div className="status-indicator">{statusIcon}</div>
                  <div className="member-simple-info">
                    <h4>
                      {member.nombre} {member.apellido}
                    </h4>
                    <span className="status-text">{statusText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Voucher preview modal */}
      {voucherModal && (
        <div className="voucher-modal-overlay" onClick={() => setVoucherModal(null)}>
          <div className="voucher-modal" onClick={(e) => e.stopPropagation()}>
            <div className="voucher-modal-header">
              <div>
                <h3>{voucherModal.memberName}</h3>
                <p>{voucherModal.month} {selectedYear}</p>
              </div>
              <button className="voucher-modal-close" onClick={() => setVoucherModal(null)}>✕</button>
            </div>
            <div className="voucher-modal-body">
              <img src={voucherModal.voucherUrl} alt="Voucher de pago" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AllPayments;

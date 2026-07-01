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
  const [payments, setPayments] = useState([]);
  const [monthlyDues, setMonthlyDues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [availableYears, setAvailableYears] = useState([]);
  const [voucherModal, setVoucherModal] = useState(null); // { memberName, month, voucherUrl }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  const autoFreezeCongelados = async () => {
    await supabase.rpc("freeze_congelado_dues");
  };

  const loadData = async () => {
    try {
      setLoading(true);

      await autoFreezeCongelados();

      // Load all members
      const { data: membersData, error: membersError } = await supabase
        .from("members")
        .select("id, nombre, apellido, email, puesto, frozen_since")
        .order("nombre");

      if (membersError) throw membersError;

      // Load all payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("*")
        .gte("fecha", `${selectedYear}-01-01`)
        .lte("fecha", `${selectedYear}-12-31`)
        .order("fecha", { ascending: false });

      if (paymentsError) throw paymentsError;

      // Load all monthly dues for the selected year (to check is_frozen)
      const { data: duesData, error: duesError } = await supabase
        .from("monthly_dues")
        .select("member_id, month, year, is_frozen")
        .eq("year", selectedYear);

      if (duesError) throw duesError;

      // Get available years from payments
      const { data: allPayments } = await supabase
        .from("payments")
        .select("fecha")
        .order("fecha", { ascending: false });

      const years = [
        ...new Set(
          allPayments?.map((p) => new Date(p.fecha).getFullYear()) || []
        ),
      ].sort((a, b) => b - a);

      setMembers(membersData || []);
      setPayments(paymentsData || []);
      setMonthlyDues(duesData || []);
      setAvailableYears(years);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getMemberPayments = (memberEmail) => {
    return payments.filter((p) => p.email_registro === memberEmail);
  };

  const getPaymentForMonth = (memberEmail, month) => {
    const currentYear = selectedYear;
    const currentMonth = MONTHS.indexOf(month) + 1;

    return payments.find((p) => {
      const isCuota = p.payment_type === "cuota_mensual" || p.applies_to_month;
      if (!isCuota) return false;

      if (p.applies_to_month && p.applies_to_year) {
        return (
          p.email_registro === memberEmail &&
          p.applies_to_month === currentMonth &&
          p.applies_to_year === currentYear
        );
      }

      if (p.mes_pagado && !p.mes_pagado.toLowerCase().includes("mora")) {
        const paymentYear = new Date(p.fecha).getFullYear();
        return (
          p.email_registro === memberEmail &&
          p.mes_pagado.toLowerCase().includes(month.toLowerCase()) &&
          paymentYear === currentYear
        );
      }

      return false;
    });
  };

  const isMonthFrozen = (memberId, month) => {
    const monthIndex = MONTHS.indexOf(month) + 1; // 1-12
    const due = monthlyDues.find(
      (d) =>
        d.member_id === memberId &&
        d.month === monthIndex &&
        d.year === selectedYear
    );
    return due?.is_frozen || false;
  };

  const hasPaidMonth = (memberEmail, month) => {
    const currentYear = selectedYear;
    const currentMonth = MONTHS.indexOf(month) + 1; // 1-12

    return payments.some((p) => {
      // Only consider cuota payments (not "Mora" or other concepts)
      const isCuota = p.payment_type === "cuota_mensual" || p.applies_to_month;

      if (!isCuota) return false;

      // Match by applies_to_month and applies_to_year (most reliable)
      if (p.applies_to_month && p.applies_to_year) {
        return (
          p.email_registro === memberEmail &&
          p.applies_to_month === currentMonth &&
          p.applies_to_year === currentYear
        );
      }

      // Fallback: match by mes_pagado string (for old payments)
      // But exclude payments with "Mora" or other non-month words
      if (p.mes_pagado && !p.mes_pagado.toLowerCase().includes("mora")) {
        const paymentYear = new Date(p.fecha).getFullYear();
        return (
          p.email_registro === memberEmail &&
          p.mes_pagado.toLowerCase().includes(month.toLowerCase()) &&
          paymentYear === currentYear
        );
      }

      return false;
    });
  };

  const isMonthOverdue = (month) => {
    const currentDate = new Date();
    const currentYear = selectedYear;
    const monthIndex = MONTHS.indexOf(month);
    // Overdue starts on day 7 (day 6 is still OK to pay)
    const overdueDate = new Date(currentYear, monthIndex, 7);
    overdueDate.setHours(0, 0, 0, 0);

    return currentDate >= overdueDate;
  };

  const isMonthDueSoon = (month) => {
    const currentDate = new Date();
    const currentYear = selectedYear;
    const monthIndex = MONTHS.indexOf(month);
    const dueDate = new Date(currentYear, monthIndex, 6); // 6th of the month
    dueDate.setHours(23, 59, 59, 999); // End of day 6
    const daysUntilDue = Math.ceil(
      (dueDate - currentDate) / (1000 * 60 * 60 * 24)
    );

    // Due soon: within 10 days of due date, including the due date itself
    return daysUntilDue <= 10 && daysUntilDue >= 0;
  };

  const isRetired = (member) => member.puesto?.toLowerCase() === "retirado";

  // True when `month` (of selectedYear) falls on or after the member's leave date.
  // Months before the leave date keep their real history (paid/congelado/vencido).
  // Parses the YYYY-MM directly from frozen_since to avoid UTC-offset bugs.
  const isRetiredMonth = (member, month) => {
    if (!isRetired(member)) return false;
    const match = member.frozen_since?.toString().match(/^(\d{4})-(\d{2})/);
    if (!match) return true; // no leave date -> treat every month as retired
    const retiredYear = Number(match[1]);
    const retiredMonth = Number(match[2]); // 1-12
    const monthIndex = MONTHS.indexOf(month) + 1; // 1-12
    if (selectedYear > retiredYear) return true;
    if (selectedYear < retiredYear) return false;
    return monthIndex >= retiredMonth;
  };

  const getMonthStatus = (member, month) => {
    const paid = hasPaidMonth(member.email, month);

    if (paid) return "paid";
    // From the leave date onward: neutral gray. Earlier months fall through to real history.
    if (isRetiredMonth(member, month)) return "retired";

    const frozen = isMonthFrozen(member.id, month);
    const overdue = isMonthOverdue(month);
    const dueSoon = isMonthDueSoon(month);

    if (frozen) return "frozen";
    if (overdue) return "overdue";
    if (dueSoon) return "due-soon";
    return "pending";
  };

  const getTotalPaidByMember = (memberEmail) => {
    const memberPayments = getMemberPayments(memberEmail);
    // Only sum cuota_mensual payments
    return memberPayments.reduce((sum, p) => {
      const isCuota =
        p.payment_type === "cuota_mensual" ||
        (p.applies_to_month && p.applies_to_year);
      return isCuota ? sum + (p.monto || 0) : sum;
    }, 0);
  };

  const filteredMembers = members.map((member) => {
    const memberPayments = getMemberPayments(member.email);
    const totalPaid = getTotalPaidByMember(member.email);

    // Only count cuota payments
    const cuotaPayments = memberPayments.filter(
      (p) =>
        p.payment_type === "cuota_mensual" ||
        (p.applies_to_month && p.applies_to_year)
    );

    if (selectedMonth === "all") {
      return { ...member, totalPaid, paymentsCount: cuotaPayments.length };
    } else {
      const paidThisMonth = hasPaidMonth(member.email, selectedMonth);
      // Check if this specific month is frozen from the database
      const frozenThisMonth = isMonthFrozen(member.id, selectedMonth);
      // Check if this month is overdue (past the 6th)
      const overdueThisMonth = isMonthOverdue(selectedMonth);
      // Check if this month is due soon (within 10 days)
      const dueSoonThisMonth = isMonthDueSoon(selectedMonth);
      return {
        ...member,
        totalPaid,
        paidThisMonth,
        frozen: frozenThisMonth,
        overdue: overdueThisMonth,
        dueSoon: dueSoonThisMonth,
        retired: isRetiredMonth(member, selectedMonth),
      };
    }
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
                  const payment = status === "paid" ? getPaymentForMonth(member.email, month) : null;
                  const hasVoucher = payment?.voucher;
                  return (
                    <div
                      key={month}
                      className={`month-indicator status-${status}${hasVoucher ? " has-voucher" : ""}`}
                      title={`${month} - ${
                        status === "paid"
                          ? hasVoucher ? "Pagado — ver voucher" : "Pagado"
                          : status === "retired"
                          ? "Retirado"
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
                      {status === "retired" && "—"}
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

              if (member.paidThisMonth) {
                statusClass = "paid";
                statusText = "Pagado";
                statusIcon = "✓";
              } else if (member.frozen) {
                statusClass = "frozen";
                statusText = "Congelado";
                statusIcon = "❄️";
              } else if (member.overdue) {
                statusClass = "overdue";
                statusText = "Vencido";
                statusIcon = "✗";
              } else if (member.dueSoon) {
                statusClass = "due-soon";
                statusText = "Vence pronto";
                statusIcon = "!";
              }

              const monthPayment = member.paidThisMonth
                ? getPaymentForMonth(member.email, selectedMonth)
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

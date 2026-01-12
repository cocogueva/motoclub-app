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
        .select("id, nombre, apellido, email")
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

  const isMonthFrozen = (memberId, month) => {
    const monthIndex = MONTHS.indexOf(month) + 1; // 1-12
    const due = monthlyDues.find(
      (d) => d.member_id === memberId && d.month === monthIndex && d.year === selectedYear
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
    const dueDate = new Date(currentYear, monthIndex, 6); // 6th of the month

    return currentDate > dueDate;
  };

  const isMonthDueSoon = (month) => {
    const currentDate = new Date();
    const currentYear = selectedYear;
    const monthIndex = MONTHS.indexOf(month);
    const dueDate = new Date(currentYear, monthIndex, 6); // 6th of the month
    const daysUntilDue = Math.ceil(
      (dueDate - currentDate) / (1000 * 60 * 60 * 24)
    );

    return daysUntilDue <= 15 && daysUntilDue > 0;
  };

  const getMonthStatus = (member, month) => {
    const paid = hasPaidMonth(member.email, month);
    const frozen = isMonthFrozen(member.id, month);
    const overdue = isMonthOverdue(month);
    const dueSoon = isMonthDueSoon(month);

    if (paid) return "paid";
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
      return { ...member, totalPaid, paidThisMonth, frozen: frozenThisMonth };
    }
  });

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
            {members.length} {members.length === 1 ? "miembro" : "miembros"}
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
          {filteredMembers.map((member, index) => (
            <div
              key={member.id}
              className="payment-status-card fade-in"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="member-info-row">
                <div>
                  <h3 className="member-name-card">
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
                  return (
                    <div
                      key={month}
                      className={`month-indicator status-${status}`}
                      title={`${month} - ${
                        status === "paid"
                          ? "Pagado"
                          : status === "frozen"
                          ? "Congelado"
                          : status === "overdue"
                          ? "Vencido"
                          : status === "due-soon"
                          ? "Próximo vencimiento"
                          : "Pendiente"
                      }`}
                    >
                      {status === "paid" && "✓"}
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
              {filteredMembers.filter((m) => m.paidThisMonth).length} de{" "}
              {filteredMembers.filter((m) => !m.frozen).length} miembros pagaron
              {filteredMembers.filter((m) => m.frozen).length > 0 && (
                <span> ({filteredMembers.filter((m) => m.frozen).length} congelados)</span>
              )}
            </p>
          </div>

          <div className="members-simple-grid">
            {filteredMembers.map((member, index) => (
              <div
                key={member.id}
                className={`member-simple-card ${
                  member.paidThisMonth ? "paid" : member.frozen ? "frozen" : "unpaid"
                } fade-in`}
                style={{ animationDelay: `${index * 0.03}s` }}
              >
                <div className="status-indicator">
                  {member.paidThisMonth ? "✓" : member.frozen ? "❄️" : "✗"}
                </div>
                <div className="member-simple-info">
                  <h4>
                    {member.nombre} {member.apellido}
                  </h4>
                  <span className="status-text">
                    {member.paidThisMonth ? "Pagado" : member.frozen ? "Congelado" : "No pagado"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default AllPayments;

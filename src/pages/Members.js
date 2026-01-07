import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import "./Members.css";

function Members() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .order("nombre", { ascending: true });

      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error("Error loading members:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredMembers = members.filter((member) => {
    const search = searchTerm.toLowerCase();
    return (
      member.nombre?.toLowerCase().includes(search) ||
      member.apellido?.toLowerCase().includes(search) ||
      member.apodo?.toLowerCase().includes(search) ||
      member.marca_moto?.toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <div className="members-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="members-page">
      <div className="members-header">
        <h1 className="page-title">Miembros del Club</h1>
        <p className="page-subtitle">
          {members.length} {members.length === 1 ? "miembro" : "miembros"}{" "}
          registrados
        </p>
      </div>

      <div className="search-bar fade-in">
        <input
          type="text"
          placeholder="Buscar por nombre, apellido, apodo o moto..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <span className="search-icon">🔍</span>
      </div>

      {filteredMembers.length === 0 ? (
        <div className="no-results">
          <p>
            No se encontraron miembros {searchTerm && `con "${searchTerm}"`}
          </p>
        </div>
      ) : (
        <div className="members-grid">
          {filteredMembers.map((member, index) => (
            <div
              key={member.id}
              className="member-card fade-in"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              {member.foto && (
                <div className="member-photo">
                  <img src={member.foto} alt={member.nombre} />
                </div>
              )}

              <div className="member-info">
                <h3 className="member-name">
                  {member.apodo || `${member.nombre} ${member.apellido}`}
                </h3>

                {member.apodo && (
                  <p className="member-fullname">
                    {member.nombre} {member.apellido}
                  </p>
                )}

                <div className="member-details">
                  {member.puesto && (
                    <div className="detail-item">
                      <span className="detail-icon">👤</span>
                      <span>{member.puesto}</span>
                    </div>
                  )}

                  {member.marca_moto && (
                    <div className="detail-item">
                      <span className="detail-icon">🏍️</span>
                      <span>
                        {member.marca_moto} {member.modelo}
                      </span>
                    </div>
                  )}

                  {member.tipo_sangre && (
                    <div className="detail-item">
                      <span className="detail-icon">🩸</span>
                      <span>{member.tipo_sangre}</span>
                    </div>
                  )}

                  {member.telefono && (
                    <div className="detail-item">
                      <span className="detail-icon">📱</span>
                      <span>{member.telefono}</span>
                    </div>
                  )}
                </div>

                {member.email && (
                  <a href={`mailto:${member.email}`} className="member-email">
                    {member.email}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Members;

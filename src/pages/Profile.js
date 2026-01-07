import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import "./Profile.css";

const POSITIONS = [
  "Presidente",
  "Vice Presidente",
  "Sgto de Armas",
  "Tesorero",
  "Secretario",
  "Cap de Ruta",
  "Miembro",
];

function Profile() {
  const [user, setUser] = useState(null);
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formData, setFormData] = useState({});
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);

      const { data: memberData } = await supabase
        .from("members")
        .select("*")
        .eq("email", user.email)
        .single();

      setMemberData(memberData);
      setFormData(memberData || {});
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setEditing(true);
    setMessage("");
  };

  const handleCancel = () => {
    setEditing(false);
    setFormData(memberData || {});
    setPhotoFile(null);
    setPhotoPreview(null);
    setMessage("");
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadPhoto = async () => {
    if (!photoFile) return formData.foto;

    try {
      setUploadingPhoto(true);

      // Upload to Supabase Storage
      const fileExt = photoFile.name.split(".").pop();
      const fileName = `${user.id}_profile.${fileExt}`;
      const filePath = `profiles/${fileName}`;

      // Delete old photo if exists
      if (memberData.foto) {
        const oldPath = memberData.foto.split("/").pop();
        await supabase.storage.from("profiles").remove([`profiles/${oldPath}`]);
      }

      const { error: uploadError } = await supabase.storage
        .from("profiles")
        .upload(filePath, photoFile, { upsert: true });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("profiles").getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error("Error uploading photo:", error);
      throw error;
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage("");

      // Upload photo if changed
      let photoUrl = formData.foto;
      if (photoFile) {
        photoUrl = await uploadPhoto();
      }

      const updateData = { ...formData, foto: photoUrl };

      const { error } = await supabase
        .from("members")
        .update(updateData)
        .eq("email", user.email);

      if (error) throw error;

      setMemberData(updateData);
      setFormData(updateData);
      setEditing(false);
      setPhotoFile(null);
      setPhotoPreview(null);
      setMessage("¡Perfil actualizado exitosamente!");

      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Error updating profile:", error);
      if (error.message.includes("unique_leadership_positions")) {
        setMessage(
          "Error: Ya existe alguien con ese puesto. Solo puede haber un líder por puesto."
        );
      } else {
        setMessage("Error al actualizar el perfil: " + error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1 className="page-title">Mi Perfil</h1>
        {!editing && memberData && (
          <button className="btn btn-edit" onClick={handleEdit}>
            ✏️ Editar
          </button>
        )}
      </div>

      {message && (
        <div
          className={`profile-message ${
            message.includes("Error") ? "message-error" : "message-success"
          }`}
        >
          {message}
        </div>
      )}

      <div className="profile-content fade-in">
        <div className="profile-photo-section">
          <div className="profile-photo-container">
            <img
              src={photoPreview || formData.foto || "/default-avatar.png"}
              alt={formData.nombre || "Profile"}
              className="profile-photo"
              onError={(e) => {
                e.target.src =
                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="150" height="150"%3E%3Crect fill="%232a2a2a" width="150" height="150"/%3E%3Ctext fill="%23666" font-family="Arial" font-size="60" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E👤%3C/text%3E%3C/svg%3E';
              }}
            />
            {editing && (
              <div className="photo-edit-overlay">
                <label htmlFor="photo-upload" className="photo-upload-btn">
                  📷 Cambiar Foto
                </label>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  style={{ display: "none" }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="profile-card">
          <h2 className="section-title">Información de Cuenta</h2>

          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Email</span>
              <span className="info-value">{user?.email}</span>
            </div>

            <div className="info-item">
              <span className="info-label">Último acceso</span>
              <span className="info-value">
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "N/A"}
              </span>
            </div>
          </div>
        </div>

        {memberData && (
          <>
            <div className="profile-card">
              <h2 className="section-title">Información Personal</h2>

              <div className="info-grid">
                <EditableField
                  label="Nombre"
                  value={formData.nombre || ""}
                  editing={editing}
                  onChange={(v) => handleChange("nombre", v)}
                />

                <EditableField
                  label="Apellido"
                  value={formData.apellido || ""}
                  editing={editing}
                  onChange={(v) => handleChange("apellido", v)}
                />

                <EditableField
                  label="Apodo"
                  value={formData.apodo || ""}
                  editing={editing}
                  onChange={(v) => handleChange("apodo", v)}
                  placeholder="Opcional"
                />

                <div className="info-item">
                  <span className="info-label">Puesto</span>
                  {editing ? (
                    <select
                      value={formData.puesto || "Miembro"}
                      onChange={(e) => handleChange("puesto", e.target.value)}
                      className="edit-input"
                    >
                      {POSITIONS.map((pos) => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="info-value">
                      {formData.puesto || "Miembro"}
                    </span>
                  )}
                </div>

                <EditableField
                  label="Teléfono"
                  value={formData.telefono || ""}
                  editing={editing}
                  onChange={(v) => handleChange("telefono", v)}
                />

                <EditableField
                  label="Tipo de Sangre"
                  value={formData.tipo_sangre || ""}
                  editing={editing}
                  onChange={(v) => handleChange("tipo_sangre", v)}
                  placeholder="Ej: O+, A-, etc."
                />
              </div>
            </div>

            <div className="profile-card">
              <h2 className="section-title">Mi Motocicleta</h2>

              <div className="info-grid">
                <EditableField
                  label="Marca"
                  value={formData.marca_moto || ""}
                  editing={editing}
                  onChange={(v) => handleChange("marca_moto", v)}
                />

                <EditableField
                  label="Modelo"
                  value={formData.modelo || ""}
                  editing={editing}
                  onChange={(v) => handleChange("modelo", v)}
                />

                <EditableField
                  label="Placa"
                  value={formData.placa || ""}
                  editing={editing}
                  onChange={(v) => handleChange("placa", v)}
                />

                <EditableField
                  label="Cilindrada"
                  value={formData.cilindrada || ""}
                  editing={editing}
                  onChange={(v) => handleChange("cilindrada", v)}
                  placeholder="Ej: 750cc"
                />
              </div>
            </div>

            <div className="profile-card">
              <h2 className="section-title">Contacto de Emergencia</h2>

              <div className="info-grid">
                <EditableField
                  label="Nombre"
                  value={formData.contacto_emergencia || ""}
                  editing={editing}
                  onChange={(v) => handleChange("contacto_emergencia", v)}
                />

                <EditableField
                  label="Teléfono"
                  value={formData.telefono_emergencia || ""}
                  editing={editing}
                  onChange={(v) => handleChange("telefono_emergencia", v)}
                />
              </div>
            </div>
          </>
        )}

        <div className="profile-actions">
          {editing ? (
            <>
              <button
                className="btn"
                onClick={handleSave}
                disabled={saving || uploadingPhoto}
              >
                {uploadingPhoto
                  ? "Subiendo foto..."
                  : saving
                  ? "Guardando..."
                  : "✓ Guardar Cambios"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={handleLogout}>
              Cerrar Sesión
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditableField({ label, value, editing, onChange, placeholder = "" }) {
  return (
    <div className="info-item">
      <span className="info-label">{label}</span>
      {editing ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="edit-input"
        />
      ) : (
        <span className="info-value">{value || "-"}</span>
      )}
    </div>
  );
}

export default Profile;

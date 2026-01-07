import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { supabase } from "./supabaseClient";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import Payments from "./pages/Payments";
import AllPayments from "./pages/AllPayments";
import MyDues from "./pages/MyDues";
import Profile from "./pages/Profile";
import Layout from "./components/Layout";
import "./App.css";

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Cargando...</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {!session ? (
          <>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/members" element={<Members />} />
            <Route path="/my-dues" element={<MyDues />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/all-payments" element={<AllPayments />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </Router>
  );
}

export default App;

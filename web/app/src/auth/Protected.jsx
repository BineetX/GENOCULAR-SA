import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider.jsx";

export default function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-sm text-gray-500">Checking session…</div>;
  if (!user) return <Navigate to="/signin" replace />;
  return children;
}


import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Directory from './pages/Directory';
import FamilyDetail from './pages/FamilyDetail';
import AdminDashboard from './pages/AdminDashboard';
import InviteRequired from './components/InviteRequired';
import { Toaster } from 'sonner';
import InstallPWA from './components/InstallPWA';

function AppContent() {
  const { user, profile, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg-natural">
        <div className="w-24 h-auto mb-8 animate-pulse">
          <img src="/logo.png" alt="Redeemer Logo" className="w-full h-auto opacity-20" />
        </div>
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-sage"></div>
      </div>
    );
  }

  // If not logged in, show Login
  if (!user) {
    return (
      <Routes>
        <Route path="/invite" element={<Login inviteOnly />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // If logged in but profile not yet ready, wait
  if (!profile) {
    return (
       <div className="flex flex-col items-center justify-center min-h-screen bg-bg-natural">
        <div className="w-24 h-auto mb-8 animate-pulse">
          <img src="/logo.png" alt="Redeemer Logo" className="w-full h-auto opacity-20" />
        </div>
        <p className="text-stone-light text-xs font-bold uppercase tracking-widest animate-pulse">Initializing Profile...</p>
      </div>
    );
  }

  // If role is pending, show InviteRequired
  if (profile.role === 'pending') {
    return <InviteRequired />;
  }

  return (
    <Routes>
      <Route path="/" element={<Directory />} />
      <Route path="/family/:familyId" element={<FamilyDetail />} />
      <Route path="/admin" element={isAdmin ? <AdminDashboard onClose={() => {}} /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <InstallPWA />
        <AppContent />
        <Toaster position="top-center" />
      </AuthProvider>
    </BrowserRouter>
  );
}

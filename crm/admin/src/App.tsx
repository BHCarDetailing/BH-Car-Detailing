import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import Layout from "./components/Layout";

function Soon({ name }: { name: string }) {
  return <div className="p-4 text-neutral-500 md:p-8">{name} — building…</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pipeline" element={<Soon name="Pipeline" />} />
        <Route path="/calendar" element={<Soon name="Calendar" />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
      </Route>
    </Routes>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Layout from "./components/Layout";

function Placeholder({ name }: { name: string }) {
  return <div className="p-8 text-neutral-500">{name} — coming in the next task.</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Placeholder name="Dashboard" />} />
        <Route path="/contacts" element={<Placeholder name="Contacts" />} />
        <Route path="/contacts/:id" element={<Placeholder name="Contact" />} />
      </Route>
    </Routes>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import Reactivation from "./pages/Reactivation";
import ContactDetail from "./pages/ContactDetail";
import Pipeline from "./pages/Pipeline";
import Calendar from "./pages/Calendar";
import Inbox from "./pages/Inbox";
import Import from "./pages/Import";
import Settings from "./pages/Settings";
import Sequences from "./pages/Sequences";
import Book from "./pages/Book";
import Quote from "./pages/Quote";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { CommandPaletteProvider } from "./components/CommandPalette";
// Operating-system pages
import Home from "./pages/Home";
import GTM from "./pages/GTM";
import Discovery from "./pages/Discovery";
import Clients from "./pages/Clients";
import Revenue from "./pages/Revenue";
import Onboarding from "./pages/Onboarding";
import Kpi from "./pages/Kpi";
import Accountability from "./pages/Accountability";
import Team from "./pages/Team";
import Updates from "./pages/Updates";
import AskClaude from "./pages/AskClaude";
import Products from "./pages/Products";
import Partners from "./pages/Partners";
import Advisors from "./pages/Advisors";
import DocsLegal from "./pages/DocsLegal";

export default function App() {
  return (
    <ToastProvider>
      <CommandPaletteProvider>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/book" element={<Book />} />
      <Route path="/quote/:token" element={<Quote />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {/* Growth */}
        <Route path="/gtm" element={<GTM />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/revenue" element={<Revenue />} />
        {/* Operations */}
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/reactivation" element={<Reactivation />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/products" element={<Products />} />
        {/* Performance */}
        <Route path="/kpi" element={<Kpi />} />
        <Route path="/accountability" element={<Accountability />} />
        <Route path="/updates" element={<Updates />} />
        {/* People */}
        <Route path="/team" element={<Team />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/advisors" element={<Advisors />} />
        {/* Tools */}
        <Route path="/ask" element={<AskClaude />} />
        <Route path="/sequences" element={<Sequences />} />
        <Route path="/import" element={<Import />} />
        <Route path="/docs" element={<DocsLegal />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
      </CommandPaletteProvider>
    </ToastProvider>
  );
}

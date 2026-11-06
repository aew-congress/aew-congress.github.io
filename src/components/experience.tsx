"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut, User,
} from "firebase/auth";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Download, Eye,
  EyeOff, FileCheck2, FileText, Filter, Leaf, LockKeyhole, LogOut, Mail, MapPin,
  Menu, Plus, Search, ShieldCheck, Sparkles, Upload, UserRound, UsersRound, X,
} from "lucide-react";
import { auth, db, Material, MaterialCategory, Program, ProgramSession, SUPERADMIN_EMAIL, UserProfile } from "@/lib/firebase";
import { uploadFiles } from "@/lib/uploadthing";

type Section = "programs" | "materials" | "approval" | "manage";
type Track = "Break" | "Breakout" | "Closing" | "Logistics" | "Meeting" | "Opening" | "Plenary";
const tracks: Track[] = ["Break", "Breakout", "Closing", "Logistics", "Meeting", "Opening", "Plenary"];
const categories: MaterialCategory[] = ["Guidelines", "Presentation", "References", "Worksheet"];
const suffixes = ["Jr.", "Sr.", "II", "III", "IV", "V", "VI"];

const trackColors: Record<string, string> = {
  Break: "track-break", Breakout: "track-breakout", Closing: "track-closing",
  Logistics: "track-logistics", Meeting: "track-meeting", Opening: "track-opening", Plenary: "track-plenary",
};

function displayDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!date) return "Date to be announced";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", options);
}

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const month = new Intl.DateTimeFormat("en-PH", { month: "short" });
  const year = start.getFullYear() === end.getFullYear() ? start.getFullYear() : `${start.getFullYear()}–${end.getFullYear()}`;
  if (from === to) return `${month.format(start)} ${start.getDate()}, ${year}`;
  if (start.getMonth() === end.getMonth()) return `${month.format(start)} ${start.getDate()}–${end.getDate()}, ${year}`;
  return `${month.format(start)} ${start.getDate()} – ${month.format(end)} ${end.getDate()}, ${year}`;
}

function fullName(person: Partial<UserProfile>) {
  return [person.firstName, person.middleName, person.lastName, person.suffix].filter(Boolean).join(" ");
}

function passwordScore(value: string) {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  return Math.min(score, 5);
}

function errorText(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "That email and password combination could not be verified.";
  if (code === "auth/email-already-in-use") return "An account already uses this email address. Try signing in instead.";
  if (code === "auth/weak-password") return "Choose a stronger password with at least 8 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a little and try again.";
  if (code === "auth/network-request-failed") return "Check your internet connection and try again.";
  if (code === "permission-denied") return "This action is not allowed for your account.";
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

export default function Experience() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [section, setSection] = useState<Section>("programs");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);
  const [trackFilter, setTrackFilter] = useState<string>("All tracks");
  const [search, setSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "create" | "reset">("login");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [programModal, setProgramModal] = useState(false);
  const [materialModal, setMaterialModal] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [cloudIssue, setCloudIssue] = useState("");
  const [loading, setLoading] = useState(true);

  const isAdmin = Boolean(user && user.email?.toLowerCase() === SUPERADMIN_EMAIL && user.emailVerified);
  const isApprovedMember = Boolean(user && activeProfile?.status === "Approved" && user.emailVerified);
  const signedIn = isAdmin || isApprovedMember;
  const selectedProgram = programs.find((program) => program.id === selectedProgramId) ?? programs[0];
  const days = useMemo(() => {
    if (!selectedProgram) return [];
    const first = new Date(`${selectedProgram.dateFrom}T12:00:00`);
    const last = new Date(`${selectedProgram.dateTo}T12:00:00`);
    const values: string[] = [];
    for (const d = new Date(first); d <= last && values.length < 31; d.setDate(d.getDate() + 1)) values.push(d.toISOString().slice(0, 10));
    return values.length ? values : [selectedProgram.dateFrom];
  }, [selectedProgram]);
  const filteredSessions = useMemo(() => {
    if (!selectedProgram) return [];
    const selectedDate = days[selectedDay];
    return selectedProgram.flow.filter((item) => {
      const matchesDay = item.date === selectedDate;
      const matchesTrack = trackFilter === "All tracks" || item.track === trackFilter;
      const needle = search.trim().toLowerCase();
      const matchesSearch = !needle || `${item.session} ${item.responsible} ${item.track}`.toLowerCase().includes(needle);
      return matchesDay && matchesTrack && matchesSearch;
    }).sort((a, b) => a.time.localeCompare(b.time));
  }, [days, selectedDay, selectedProgram, search, trackFilter]);

  useEffect(() => {
    const stopPrograms = onSnapshot(query(collection(db, "programs"), orderBy("dateFrom", "asc")), (snapshot) => {
      setPrograms(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Program)));
      setCloudIssue("");
      setLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setLoading(false); });
    const stopAuth = onAuthStateChanged(auth, async (current) => {
      setUser(current);
      if (!current) { setActiveProfile(null); return; }
      if (current.email?.toLowerCase() === SUPERADMIN_EMAIL) {
        if (current.emailVerified) setActiveProfile(null);
        else {
          await signOut(auth);
          setToast({ kind: "info", text: "Verify the superadmin email address before using admin tools." });
        }
        return;
      }
      try {
        const profileSnapshot = await getDoc(doc(db, "userProfiles", current.uid));
        if (!profileSnapshot.exists()) { await signOut(auth); return; }
        const profile = profileSnapshot.data() as UserProfile;
        if (profile.status !== "Approved" || !current.emailVerified) {
          await signOut(auth);
          setActiveProfile(profile);
          return;
        }
        setActiveProfile(profile);
      } catch { setActiveProfile(null); }
    });
    return () => { stopPrograms(); stopAuth(); };
  }, []);

  useEffect(() => {
    if (!signedIn) { setMaterials([]); return; }
    const stopMaterials = onSnapshot(query(collection(db, "materials"), orderBy("createdAt", "desc")), (snapshot) => {
      setMaterials(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Material)));
    }, (error) => setCloudIssue(errorText(error)));
    return stopMaterials;
  }, [signedIn]);

  useEffect(() => {
    if (!isAdmin) { setProfiles([]); return; }
    const stopProfiles = onSnapshot(query(collection(db, "userProfiles"), orderBy("createdAt", "desc")), (snapshot) => {
      setProfiles(snapshot.docs.map((entry) => entry.data() as UserProfile));
    }, (error) => setCloudIssue(errorText(error)));
    return stopProfiles;
  }, [isAdmin]);

  useEffect(() => {
    if (programs.length && (!selectedProgramId || !programs.some((program) => program.id === selectedProgramId))) {
      setSelectedProgramId(programs[0].id);
      setSelectedDay(0);
    }
  }, [programs, selectedProgramId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showError(error: unknown) { setToast({ kind: "error", text: errorText(error) }); }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (email === SUPERADMIN_EMAIL) {
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          setToast({ kind: "info", text: "A verification link was sent to the superadmin email address." });
          setAuthOpen(false);
          return;
        }
        setSection("approval");
        setAuthOpen(false);
        return;
      }
      const profileSnapshot = await getDoc(doc(db, "userProfiles", credential.user.uid));
      if (!profileSnapshot.exists()) {
        await signOut(auth);
        throw new Error("We couldn't find a registration for this account. Please create an account first.");
      }
      const profile = profileSnapshot.data() as UserProfile;
      setActiveProfile(profile);
      if (profile.status === "Pending") {
        await signOut(auth);
        setToast({ kind: "info", text: "Your account is awaiting approval. You can sign in after the administrator approves it." });
        setAuthOpen(false);
        return;
      }
      if (profile.status === "Disapproved") {
        await signOut(auth);
        setToast({ kind: "error", text: "This account was not approved. Contact your office administrator for assistance." });
        setAuthOpen(false);
        return;
      }
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user);
        await signOut(auth);
        setToast({ kind: "info", text: "Your account is approved. A verification link has been sent to your email." });
        setAuthOpen(false);
        return;
      }
      setSection("programs");
      setAuthOpen(false);
      setToast({ kind: "success", text: `Welcome back, ${profile.firstName}.` });
    } catch (error) { showError(error); }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    const confirmation = String(form.get("confirmation"));
    const phone = String(form.get("phone")).replace(/\D/g, "");
    if (email === SUPERADMIN_EMAIL) { setToast({ kind: "error", text: "The superadmin account must be provisioned through Firebase Authentication." }); return; }
    if (password !== confirmation) { setToast({ kind: "error", text: "The passwords do not match." }); return; }
    if (passwordScore(password) < 3) { setToast({ kind: "error", text: "Choose a stronger password before creating your account." }); return; }
    if (phone.length !== 9) { setToast({ kind: "error", text: "Enter the 9 digits after +63 9." }); return; }
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const profile: UserProfile = {
        uid: credential.user.uid,
        firstName: String(form.get("firstName")).trim(),
        middleName: String(form.get("middleName")).trim(),
        lastName: String(form.get("lastName")).trim(),
        suffix: String(form.get("suffix") || ""),
        birthdate: String(form.get("birthdate")),
        sexAtBirth: String(form.get("sexAtBirth")) as "Male" | "Female",
        contactNo: `+63 9${phone}`,
        position: String(form.get("position")).trim(),
        designation: String(form.get("designation")).trim(),
        office: String(form.get("office")).trim(),
        email,
        status: "Pending",
        createdAt: serverTimestamp(),
      };
      await (await import("firebase/firestore")).setDoc(doc(db, "userProfiles", credential.user.uid), profile);
      await signOut(auth);
      formElement.reset();
      setAuthOpen(false);
      setToast({ kind: "success", text: "Registration received. You can sign in once your account has been approved." });
    } catch (error) { showError(error); }
  }

  async function handleForgotPassword(email: string) {
    if (!email.trim()) { setToast({ kind: "error", text: "Enter the email address on your account." }); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setAuthOpen(false);
      setToast({ kind: "success", text: "If an account exists for that address, a password reset link is on its way." });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "auth/user-not-found" || code === "auth/invalid-email") {
        setAuthOpen(false);
        setToast({ kind: "success", text: "If an account exists for that address, a password reset link is on its way." });
      } else showError(error);
    }
  }

  async function changeStatus(profile: UserProfile, status: UserProfile["status"]) {
    try {
      await updateDoc(doc(db, "userProfiles", profile.uid), { status, reviewedAt: serverTimestamp() });
      setToast({ kind: "success", text: `${fullName(profile)} marked ${status.toLowerCase()}.` });
    } catch (error) { showError(error); }
  }

  async function createProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !isAdmin) {
      setProgramModal(false);
      setToast({ kind: "error", text: `Sign in with the verified superadmin account (${SUPERADMIN_EMAIL}) to publish programs.` });
      return;
    }
    const form = new FormData(event.currentTarget);
    const flow = JSON.parse(String(form.get("flowJson"))) as ProgramSession[];
    const payload = {
      eventTitle: String(form.get("eventTitle")).trim(),
      dateFrom: String(form.get("dateFrom")),
      dateTo: String(form.get("dateTo")),
      venue: String(form.get("venue")).trim(),
      description: String(form.get("description")).trim(),
      flow,
      createdAt: serverTimestamp(),
      createdBy: user?.uid,
    };
    if (payload.dateTo < payload.dateFrom) { setToast({ kind: "error", text: "The end date must be on or after the start date." }); return; }
    try {
      await user.getIdToken(true);
      const created = await addDoc(collection(db, "programs"), payload);
      setSelectedProgramId(created.id);
      setSection("programs");
      setProgramModal(false);
      setToast({ kind: "success", text: "Program published." });
    } catch (error) {
      if ((error as { code?: string })?.code === "permission-denied") {
        setToast({ kind: "error", text: "Firestore denied this program write. Confirm the verified superadmin account is signed in and the latest Firestore rules are deployed." });
        return;
      }
      showError(error);
    }
  }

  async function createMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const targetProgram = programs.find((program) => program.id === String(form.get("programId")));
    if (!targetProgram) { setToast({ kind: "error", text: "Choose a published program for this material." }); return; }
    const file = form.get("materialFile");
    const externalUrl = String(form.get("materialUrl")).trim();
    const category = String(form.get("category")) as MaterialCategory;
    let url = externalUrl;
    let name = String(form.get("materialName")).trim();
    if (file instanceof File && file.size > 0) {
      if (!process.env.NEXT_PUBLIC_UPLOADTHING_URL) {
        setToast({ kind: "error", text: "File uploads need the Firebase UploadThing endpoint set in the Pages build environment." });
        return;
      }
      setUploadBusy(true);
      try {
        const result = await uploadFiles("materialUploader", {
          files: [file],
          headers: async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }),
        });
        url = result[0]?.ufsUrl ?? "";
        name = name || file.name;
      } catch (error) { setUploadBusy(false); showError(error); return; }
      setUploadBusy(false);
    }
    if (!url) { setToast({ kind: "error", text: "Add a resource link or choose a file to upload." }); return; }
    try {
      await addDoc(collection(db, "materials"), {
        programId: targetProgram.id,
        programTitle: targetProgram.eventTitle,
        category,
        name: name || url.split("/").pop() || "Program resource",
        url,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      formElement.reset();
      setMaterialModal(false);
      setToast({ kind: "success", text: "Material added to the resource library." });
    } catch (error) { showError(error); }
  }

  async function logout() {
    await signOut(auth);
    setSection("programs");
    setToast({ kind: "success", text: "You have signed out." });
  }

  const navItems: { id: Section; label: string }[] = [
    { id: "programs", label: "Programs" },
    ...(signedIn ? [{ id: "materials" as Section, label: "Materials" }] : []),
    ...(isAdmin ? [{ id: "approval" as Section, label: "User approval" }] : []),
  ];

  return (
    <div className="site-shell">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="AEW Caraga home">
          <span className="brand-mark"><img src="/AEW_logo.png" alt="" /></span>
          <span className="brand-wording"><strong>AEW <em>CARAGA</em></strong><small>PROGRAMS & MATERIALS</small></span>
        </a>
        <nav className={`primary-nav ${mobileMenuOpen ? "primary-nav--open" : ""}`} aria-label="Primary navigation">
          {navItems.map((item) => <button key={item.id} className={section === item.id ? "nav-link nav-link--active" : "nav-link"} onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}>{item.label}{item.id === "approval" && profiles.filter((p) => p.status === "Pending").length > 0 && <span className="nav-count">{profiles.filter((p) => p.status === "Pending").length}</span>}</button>)}
        </nav>
        <div className="topbar-actions">
          {signedIn ? <><span className="signed-in-label"><span className="online-dot" />{isAdmin ? "Superadmin" : activeProfile?.firstName}</span><IconButton label="Sign out" onClick={logout}><LogOut size={18} /></IconButton></> : <button className="login-link" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}><span>Log in</span><span className="login-icon"><UserRound size={17} /></span></button>}
          <button className="mobile-menu-button" aria-label="Toggle navigation" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>
        </div>
      </header>

      <main id="top">
        {section === "approval" && isAdmin ? (
          <ApprovalDashboard profiles={profiles} loading={loading} onChangeStatus={changeStatus} onAddProgram={() => setProgramModal(true)} onAddMaterial={() => setMaterialModal(true)} />
        ) : section === "manage" && isAdmin ? (
          <ManageDashboard programs={programs} materials={materials} onAddProgram={() => setProgramModal(true)} onAddMaterial={() => setMaterialModal(true)} onBack={() => setSection("approval")} />
        ) : section === "materials" ? (
          <MaterialsPage materials={materials} programs={programs} isAdmin={isAdmin} onAdd={() => setMaterialModal(true)} loading={loading} />
        ) : (
          <>
            <section className="hero content-wrap">
              <div className="hero-copy">
                <span className="eyebrow"><span className="eyebrow-dot" />A shared space for learning</span>
                <h1>Good programs<br /><span>make room</span> for <i>growth.</i></h1>
                <p>Explore published learning sessions, follow the daily flow, and find resources shared by the community.</p>
                <div className="hero-actions"><button className="button button--olive" onClick={() => document.getElementById("program-list")?.scrollIntoView({ behavior: "smooth" })}>Explore programs <ArrowDownRight size={17} /></button><button className="text-action" onClick={() => { if (signedIn) setSection("materials"); else { setAuthMode("login"); setAuthOpen(true); } }}>{signedIn ? "Browse materials" : "Member access"} <ArrowRight size={16} /></button></div>
                <div className="hero-note"><Leaf size={17} /><span>For agricultural extension workers<br /><strong>across the Caraga Region.</strong></span></div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="art-sun" />
                <div className="art-card art-card--back"><span className="mini-label">LEARN / SHARE / GROW</span><div className="art-note-mark"><Leaf size={25} /></div><span className="art-year">AEW CARAGA</span></div>
                <div className="art-card art-card--front"><div className="art-leaf"><Leaf size={25} /></div><span className="mini-label">CARAGA REGION XIII</span><strong>Learn together.<br />Grow together.</strong><span className="art-line" /><span className="art-detail">Shared knowledge for stronger communities</span></div>
                <div className="art-sticker"><Sparkles size={15} /><span>Curiosity<br />in action</span></div>
                <span className="art-caption">LEARN / SHARE / GROW</span>
              </div>
              <div className="hero-bottomline"><span>REGIONAL KNOWLEDGE, SHARED LOCALLY</span><span>AEW CARAGA / REGION XIII</span></div>
            </section>

            <section className="content-wrap program-section" id="program-list">
              <div className="section-heading"><div><span className="eyebrow">THE CALENDAR</span><h2>Programs <span>& gatherings</span></h2></div><div className="heading-side"><span className="section-count">{programs.length.toString().padStart(2, "0")} <span>PROGRAMS</span></span>{isAdmin && <button className="button button--soft" onClick={() => setProgramModal(true)}><Plus size={16} /> New program</button>}</div></div>
              <div className="program-cards">
                {programs.map((program, index) => <button key={program.id} className={`program-card ${selectedProgram?.id === program.id ? "program-card--selected" : ""}`} onClick={() => { setSelectedProgramId(program.id); setSelectedDay(0); }}>
                  <span className={`program-card-num program-card-num--${index % 3}`}>{String(index + 1).padStart(2, "0")}</span><div className="program-card-main"><span className="card-date"><CalendarDays size={13} />{dateRange(program.dateFrom, program.dateTo)}</span><h3>{program.eventTitle}</h3><span className="card-location"><MapPin size={13} />{program.venue}</span></div><span className="program-card-arrow"><ArrowUpRight size={18} /></span>
                </button>)}
              </div>
              {!programs.length && <div className="program-empty"><CalendarDays size={22} /><div><strong>{loading ? "Loading programs..." : "No programs have been published yet."}</strong><span>{loading ? "Published programs will appear here." : isAdmin ? "Add a program to share it with the community." : "Please check back later for upcoming programs."}</span></div>{isAdmin && !loading && <button className="button button--soft" onClick={() => setProgramModal(true)}><Plus size={16} /> New program</button>}</div>}
            </section>

            {selectedProgram ? <section className="content-wrap schedule-section" id="schedule">
              <div className="schedule-topline"><div className="schedule-kicker"><span className="live-pill"><span />PROGRAM FLOW</span><span className="schedule-location"><MapPin size={13} />{selectedProgram?.venue}</span></div><div className="schedule-tools"><label className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions or people" aria-label="Search sessions or people" /><kbd>⌘ K</kbd></label><label className="filter-select"><Filter size={14} /><select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} aria-label="Filter by track"><option>All tracks</option>{tracks.map((track) => <option key={track}>{track}</option>)}</select><ChevronDown size={13} /></label></div></div>
              <div className="schedule-title-row"><div><span className="eyebrow">THE DAILY FLOW</span><h2>{selectedProgram?.eventTitle}</h2><p>{selectedProgram?.description || `${dateRange(selectedProgram?.dateFrom ?? "", selectedProgram?.dateTo ?? "")} · ${selectedProgram?.flow.length ?? 0} sessions`}</p></div><div className="day-controls"><button className="day-arrow" aria-label="Previous day" disabled={selectedDay === 0} onClick={() => setSelectedDay(Math.max(0, selectedDay - 1))}><ChevronLeft size={17} /></button><div className="day-tabs">{days.map((day, index) => <button key={day} className={selectedDay === index ? "day-tab day-tab--active" : "day-tab"} onClick={() => setSelectedDay(index)}><span>DAY {String(index + 1).padStart(2, "0")}</span><small>{displayDate(day, { month: "short", day: "numeric" })}</small></button>)}</div><button className="day-arrow" aria-label="Next day" disabled={selectedDay >= days.length - 1} onClick={() => setSelectedDay(Math.min(days.length - 1, selectedDay + 1))}><ChevronRight size={17} /></button></div></div>
              <div className="schedule-meta"><span><CalendarDays size={15} />{displayDate(days[selectedDay] ?? "")}</span><span><Clock3 size={15} />{filteredSessions.length} sessions today</span><button onClick={() => { setTrackFilter("All tracks"); setSearch(""); }}>Reset filters <X size={12} /></button></div>
              <div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>TIME</th><th>SESSION</th><th>TRACK</th><th>RESPONSIBLE</th></tr></thead><tbody>
                {filteredSessions.map((item, index) => <tr key={`${item.date}-${item.time}-${item.session}`} className="session-row" style={{ animationDelay: `${index * 45}ms` }}><td className="session-time">{item.time}</td><td className="session-name">{item.session}</td><td><span className={`track-pill ${trackColors[item.track] || ""}`}><span />{item.track}</span></td><td className="session-person">{item.responsible || "—"}</td></tr>)}
                {!filteredSessions.length && <tr><td colSpan={4} className="empty-table"><Search size={19} /><strong>No matching sessions</strong><span>Try another search or clear the selected track.</span></td></tr>}
              </tbody></table></div>
              <div className="schedule-footer"><span><span className="footer-spark">✳</span>Every session is a chance to share what works.</span><button onClick={() => window.print()}><Download size={15} /> Print schedule</button></div>
            </section> : <section className="content-wrap schedule-empty" id="schedule"><CalendarDays size={23} /><span className="eyebrow">PROGRAM FLOW</span><h2>{loading ? "Loading program flow..." : "No program flow available yet."}</h2><p>{loading ? "The daily schedule will appear when program data loads." : "A daily schedule will appear here after a program is published."}</p>{isAdmin && !loading && <button className="button button--olive" onClick={() => setProgramModal(true)}><Plus size={16} /> Create a program</button>}</section>}

            {signedIn && <MaterialsTeaser materials={materials} onOpen={() => setSection("materials")} />}
            {cloudIssue && <div className="content-wrap cloud-notice"><CircleHelp size={16} /><span>Live data isn’t connected yet. {cloudIssue === "Missing or insufficient permissions." ? "Add the provided Firestore rules and enable sign-in in Firebase." : cloudIssue}</span></div>}
          </>
        )}
      </main>

      <footer className="footer content-wrap"><a href="#top" className="footer-brand"><img src="/AEW_logo.png" alt="AEW Caraga" /><span>Learning travels<br /><strong>further together.</strong></span></a><span className="footer-copy">© {new Date().getFullYear()} AEW Caraga <i>·</i> For extension workers, by extension workers.</span><a href="#top" className="back-top">BACK TO TOP <ArrowUpRight size={14} /></a></footer>

      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onLogin={handleLogin} onCreate={handleCreateAccount} onForgot={handleForgotPassword} />}
      {programModal && <ProgramModal onClose={() => setProgramModal(false)} onCreate={createProgram} />}
      {materialModal && <MaterialModal programs={programs} onClose={() => setMaterialModal(false)} onCreate={createMaterial} busy={uploadBusy} />}
      {toast && <div className={`toast toast--${toast.kind}`} role="status"><span className="toast-icon">{toast.kind === "success" ? <Check size={15} /> : toast.kind === "info" ? <CircleHelp size={15} /> : <X size={15} />}</span>{toast.text}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}

function AuthModal({ mode, setMode, onClose, onLogin, onCreate, onForgot }: {
  mode: "login" | "create" | "reset"; setMode: (value: "login" | "create" | "reset") => void; onClose: () => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void; onCreate: (event: FormEvent<HTMLFormElement>) => void; onForgot: (email: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const score = passwordScore(password);
  const labels = ["Very weak", "Weak", "So-so", "Good", "Great!"];
  const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="auth-modal" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create an account" : mode === "reset" ? "Reset your password" : "Log in"}>
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
      <div className="auth-side auth-side--form">
        <div className="auth-mobile-brand"><img src="/AEW_logo.png" alt="AEW" /><span>AEW <strong>CARAGA</strong></span></div>
        <div className="auth-heading"><span className="eyebrow">{mode === "create" ? "JOIN THE COMMUNITY" : mode === "reset" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</span><h2>{mode === "create" ? <>Create your<br />account<span>.</span></> : mode === "reset" ? <>Reset your<br />password<span>.</span></> : <>Your next chapter<br />starts here<span>.</span></>}</h2><p>{mode === "create" ? "Register once your office is ready to join the learning exchange." : mode === "reset" ? "We’ll send a secure reset link to the email on your account." : "Sign in to access your programs and shared materials."}</p></div>
        {mode === "login" ? <form className="auth-form login-form" onSubmit={onLogin}>
          <Field label="Email address" icon={<UserRound size={15} />}><input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@office.gov.ph" required /></Field>
          <Field label="Password" icon={<LockKeyhole size={15} />}><input type={showPassword ? "text" : "password"} name="password" autoComplete="current-password" placeholder="Enter your password" required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></Field>
          <div className="auth-form-row"><span className="secure-note"><ShieldCheck size={13} /> Protected access</span><button type="button" className="forgot-link" onClick={() => setMode("reset")}>Forgot password?</button></div>
          <button className="button button--olive button--wide" type="submit">Log in <ArrowRight size={16} /></button>
          <p className="auth-switch">New to AEW Caraga? <button type="button" onClick={() => setMode("create")}>Create an account</button></p>
        </form> : mode === "reset" ? <form className="auth-form login-form reset-form" onSubmit={(event) => { event.preventDefault(); onForgot(email); }}>
          <Field label="Email address" icon={<Mail size={15} />}><input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@office.gov.ph" required /></Field>
          <div className="reset-note"><LockKeyhole size={15} /><span>For your privacy, we’ll show the same confirmation whether or not an account exists.</span></div>
          <button className="button button--olive button--wide" type="submit">Send reset link <ArrowRight size={16} /></button>
          <p className="auth-switch">Remembered your password? <button type="button" onClick={() => setMode("login")}>Back to log in</button></p>
        </form> : <form className="auth-form create-form" onSubmit={onCreate}>
          <div className="form-section-label">PERSONAL DETAILS <span>01 / 02</span></div>
          <div className="form-grid form-grid--four"><Field label="First name"><input name="firstName" autoComplete="given-name" placeholder="First name" required /></Field><Field label="Middle name"><input name="middleName" autoComplete="additional-name" placeholder="Middle name" /></Field><Field label="Last name"><input name="lastName" autoComplete="family-name" placeholder="Last name" required /></Field><Field label="Suffix"><select name="suffix"><option value="">—</option>{suffixes.map((suffix) => <option key={suffix}>{suffix}</option>)}</select></Field></div>
          <div className="form-grid form-grid--three"><Field label="Birthdate"><input type="date" name="birthdate" max={today} required /></Field><Field label="Sex at birth"><select name="sexAtBirth" required defaultValue=""><option value="" disabled>Select</option><option>Male</option><option>Female</option></select></Field><Field label="Contact number"><div className="phone-input"><span>+63 9</span><input name="phone" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="XX XXX XXXX" maxLength={9} required /></div></Field></div>
          <div className="form-section-label form-section-label--spaced">WORK DETAILS <span>02 / 02</span></div>
          <div className="form-grid form-grid--three"><Field label="Position"><input name="position" placeholder="e.g. Agriculturist II" required /></Field><Field label="Designation"><input name="designation" placeholder="e.g. Municipal AEW" required /></Field><Field label="Office"><input name="office" placeholder="Office or organization" required /></Field></div>
          <div className="form-grid form-grid--three"><Field label="Email address"><input type="email" name="email" autoComplete="email" placeholder="you@office.gov.ph" required /></Field><Field label="Password"><div className="password-field"><input type={showPassword ? "text" : "password"} name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field><Field label="Confirm password"><div className="password-field"><input type={showConfirmation ? "text" : "password"} name="confirmation" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Re-enter password" required /><button className="password-toggle" type="button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? "Hide password" : "Show password"}>{showConfirmation ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field></div>
          {password && <div className="strength-wrap"><div className="strength-bars">{Array.from({ length: 5 }, (_, index) => <span key={index} className={index < score ? `strength-fill strength-fill--${score}` : ""} />)}</div><span className={`strength-label strength-label--${score}`}>{labels[Math.max(0, score - 1)]}</span>{confirmation && <span className={confirmation === password ? "match-note match-note--yes" : "match-note"}>{confirmation === password ? "Passwords match" : "Passwords do not match"}</span>}</div>}
          <p className="privacy-note"><LockKeyhole size={13} /> Registration details are visible only to authorized administrators.</p>
          <button className="button button--olive button--wide" type="submit">Submit for approval <ArrowRight size={16} /></button>
          <p className="auth-switch">Already registered? <button type="button" onClick={() => setMode("login")}>Log in</button></p>
        </form>}
      </div>
      <aside className="auth-side auth-side--art"><div className="auth-art-top"><span>AEW</span><span>CARAGA<br />REGION XIII</span></div><div className="auth-orbit"><div className="orbit-circle orbit-circle--one" /><div className="orbit-circle orbit-circle--two" /><div className="orbit-circle orbit-circle--three" /><span className="orbit-seed orbit-seed--one" /><span className="orbit-seed orbit-seed--two" /><div className="orbit-core"><Leaf size={52} strokeWidth={1.2} /></div></div><div className="auth-quote"><span>“</span><p>Better knowledge.<br /><i>Stronger communities.</i></p><small>AGRICULTURAL EXTENSION WORKERS · CARAGA</small></div><div className="auth-side-foot"><span>LEARN · SHARE · GROW</span></div></aside>
    </div>
  </div>;
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{icon}{label}</span><span className="field-control">{children}</span></label>;
}

function ApprovalDashboard({ profiles, loading, onChangeStatus, onAddProgram, onAddMaterial }: {
  profiles: UserProfile[]; loading: boolean; onChangeStatus: (profile: UserProfile, status: UserProfile["status"]) => void; onAddProgram: () => void; onAddMaterial: () => void;
}) {
  const [filter, setFilter] = useState("Pending");
  const filtered = profiles.filter((profile) => filter === "All" || profile.status === filter).sort((a, b) => (a.status === "Pending" ? -1 : 1));
  const counts = { Pending: profiles.filter((p) => p.status === "Pending").length, Approved: profiles.filter((p) => p.status === "Approved").length, Disapproved: profiles.filter((p) => p.status === "Disapproved").length };
  return <div className="content-wrap dashboard-page"><div className="dashboard-welcome"><div><span className="eyebrow"><ShieldCheck size={14} /> SUPERADMIN WORKSPACE</span><h1>Good morning,<br /><span>let’s keep things</span> <i>moving.</i></h1><p>Manage registrations, shape the program calendar, and keep resources organized.</p></div><div className="dashboard-date"><span>{new Intl.DateTimeFormat("en-PH", { weekday: "long" }).format(new Date()).toUpperCase()}</span><strong>{new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric" }).format(new Date())}</strong><small>CARAGA · REGION XIII</small></div></div>
    <div className="admin-stats"><div className="admin-stat admin-stat--highlight"><span className="stat-label">NEEDS REVIEW</span><strong>{String(counts.Pending).padStart(2, "0")}</strong><span className="stat-foot"><span className="online-dot" />Pending registrations</span></div><div className="admin-stat"><span className="stat-label">APPROVED USERS</span><strong>{String(counts.Approved).padStart(2, "0")}</strong><span className="stat-foot">Cleared for sign-in</span></div><div className="admin-stat"><span className="stat-label">NOT APPROVED</span><strong>{String(counts.Disapproved).padStart(2, "0")}</strong><span className="stat-foot">Can be reviewed again</span></div><div className="admin-stat admin-quick-actions"><span className="stat-label">QUICK ACTIONS</span><button onClick={onAddProgram}><Plus size={15} /> Create a program <ArrowUpRight size={14} /></button><button onClick={onAddMaterial}><Plus size={15} /> Add a material <ArrowUpRight size={14} /></button></div></div>
    <section className="approval-panel"><div className="panel-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h2>User approval <span>& directory</span></h2><p>Approve an account to send its email verification link and unlock member access.</p></div><div className="approval-filter">{["Pending", "Approved", "Disapproved", "All"].map((status) => <button key={status} className={filter === status ? "filter-chip filter-chip--active" : "filter-chip"} onClick={() => setFilter(status)}>{status}{status === "Pending" && <span>{counts.Pending}</span>}</button>)}</div></div>
      <div className="approval-table-wrap"><table className="approval-table"><thead><tr><th>NAME / EMAIL</th><th>DESIGNATION</th><th>OFFICE</th><th>CONTACT NO.</th><th>STATUS</th></tr></thead><tbody>
        {filtered.map((profile) => <tr key={profile.uid}><td><div className="user-cell"><span className="user-avatar">{(profile.firstName?.[0] || "?")}{(profile.lastName?.[0] || "")}</span><span><strong>{fullName(profile)}</strong><small>{profile.email}</small></span></div></td><td><strong className="table-primary">{profile.designation || profile.position}</strong><small className="table-muted">{profile.position}</small></td><td>{profile.office}</td><td>{profile.contactNo}</td><td><select aria-label={`Status for ${fullName(profile)}`} className={`status-select status-select--${profile.status.toLowerCase()}`} value={profile.status} onChange={(event) => onChangeStatus(profile, event.target.value as UserProfile["status"])}><option>Pending</option><option>Approved</option><option>Disapproved</option></select></td></tr>)}
        {!filtered.length && <tr><td colSpan={5} className="empty-table"><UsersRound size={20} /><strong>{loading ? "Loading registrations…" : "No accounts in this view"}</strong><span>{loading ? "Your directory will appear in a moment." : "New registrations will show up here."}</span></td></tr>}
      </tbody></table></div><div className="table-footnote"><span><LockKeyhole size={13} /> Personal details are private to superadmins.</span><span>{filtered.length} {filtered.length === 1 ? "account" : "accounts"}</span></div>
    </section>
  </div>;
}

function ManageDashboard({ programs, materials, onAddProgram, onAddMaterial, onBack }: {
  programs: Program[]; materials: Material[]; onAddProgram: () => void; onAddMaterial: () => void; onBack: () => void;
}) {
  return <div className="content-wrap dashboard-page"><button className="back-link" onClick={onBack}><ChevronLeft size={16} /> Back to approvals</button><div className="section-heading"><div><span className="eyebrow">ORGANIZATION LIBRARY</span><h2>Programs <span>& materials</span></h2></div></div><div className="manage-grid"><div className="manage-card"><div className="manage-card-heading"><div><CalendarDays size={18} /><h3>Programs</h3></div><button className="button button--soft" onClick={onAddProgram}><Plus size={15} /> Add program</button></div>{programs.map((program) => <div className="manage-row" key={program.id}><div><strong>{program.eventTitle}</strong><small>{dateRange(program.dateFrom, program.dateTo)} · {program.venue}</small></div><span>{program.flow.length} sessions</span></div>)}{!programs.length && <p className="manage-empty">No programs have been published yet.</p>}</div><div className="manage-card"><div className="manage-card-heading"><div><FileText size={18} /><h3>Materials</h3></div><button className="button button--soft" onClick={onAddMaterial}><Plus size={15} /> Add material</button></div>{materials.map((material) => <div className="manage-row" key={material.id}><div><strong>{material.name}</strong><small>{material.programTitle} · {material.category}</small></div><a href={material.url} target="_blank" rel="noreferrer" aria-label={`Open ${material.name}`}><ArrowUpRight size={15} /></a></div>)}{!materials.length && <p className="manage-empty">The resource library is ready for its first upload.</p>}</div></div></div>;
}

function MaterialsPage({ materials, programs, isAdmin, onAdd, loading }: { materials: Material[]; programs: Program[]; isAdmin: boolean; onAdd: () => void; loading: boolean }) {
  const [category, setCategory] = useState("All resources");
  const [program, setProgram] = useState("All programs");
  const [queryText, setQueryText] = useState("");
  const displayed = materials.filter((material) => (category === "All resources" || material.category === category) && (program === "All programs" || material.programId === program) && (!queryText || `${material.name} ${material.programTitle}`.toLowerCase().includes(queryText.toLowerCase())));
  const colorByCategory: Record<string, string> = { Guidelines: "resource-green", Presentation: "resource-yellow", References: "resource-blue", Worksheet: "resource-orange" };
  return <div className="content-wrap materials-page"><section className="materials-hero"><div><span className="eyebrow"><FileCheck2 size={14} /> THE RESOURCE SHELF</span><h1>Useful things,<br /><span>within</span> <i>reach.</i></h1><p>Presentations, guides, worksheets, and references shared by the Caraga extension community.</p></div><div className="materials-hero-art"><span className="paper paper--one"><FileText size={22} /><b>FIELD<br />GUIDE</b><i /></span><span className="paper paper--two"><span>01</span><strong>Learn<br />by doing.</strong><i /></span><span className="paper paper--three"><Sparkles size={16} /><small>SHARED<br />KNOWLEDGE</small></span></div></section>
    <div className="resource-toolbar"><label className="search-box"><Search size={16} /><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Search materials" aria-label="Search materials" /></label><label className="filter-select"><Filter size={14} /><select value={program} onChange={(event) => setProgram(event.target.value)} aria-label="Filter by program"><option>All programs</option>{programs.map((item) => <option key={item.id} value={item.id}>{item.eventTitle}</option>)}</select><ChevronDown size={13} /></label>{isAdmin && <button className="button button--olive" onClick={onAdd}><Upload size={16} /> Add material</button>}</div>
    <div className="resource-categories"><button className={category === "All resources" ? "category-tab category-tab--active" : "category-tab"} onClick={() => setCategory("All resources")}>All resources <span>{materials.length}</span></button>{categories.map((item) => <button key={item} className={category === item ? "category-tab category-tab--active" : "category-tab"} onClick={() => setCategory(item)}>{item}<span>{materials.filter((m) => m.category === item).length}</span></button>)}</div>
    <div className="resource-grid">{displayed.map((material, index) => <article className={`resource-card ${colorByCategory[material.category] || ""}`} key={material.id} style={{ animationDelay: `${index * 50}ms` }}><div className="resource-card-top"><span className="resource-icon"><FileText size={20} /></span><span className="resource-category">{material.category}</span></div><h3>{material.name}</h3><p>{material.programTitle}</p><div className="resource-card-foot"><span><span className="online-dot" />Available to all members</span><a href={material.url} target="_blank" rel="noreferrer" aria-label={`Open ${material.name}`}><ArrowUpRight size={17} /></a></div></article>)}
      {!displayed.length && <div className="resource-empty"><div><FileCheck2 size={23} /></div><span className="eyebrow">A LITTLE ROOM TO GROW</span><h2>{loading ? "Gathering your materials…" : "The shelf is ready."}</h2><p>{loading ? "Shared resources will appear here." : "When a program resource is shared, you’ll find it here organized by type."}</p>{isAdmin && <button className="button button--olive" onClick={onAdd}><Plus size={16} /> Add the first material</button>}</div>}
    </div><div className="materials-footnote"><Leaf size={16} /><span>Know something useful? Share it with the team and help good ideas travel.</span></div>
  </div>;
}

function MaterialsTeaser({ materials, onOpen }: { materials: Material[]; onOpen: () => void }) {
  return <section className="content-wrap materials-teaser"><div className="teaser-copy"><span className="eyebrow">TAKE IT WITH YOU</span><h2>Good ideas are<br /><i>meant to be shared.</i></h2><p>Find guides, presentations, and worksheets shared by the community.</p><button className="text-action" onClick={onOpen}>Visit the resource shelf <ArrowRight size={16} /></button></div><div className="teaser-shelf"><div className="shelf-top"><span>THE SHARED SHELF</span><span>{String(materials.length).padStart(2, "0")} ITEMS <ArrowUpRight size={13} /></span></div><div className="shelf-items">{materials.length ? materials.slice(0, 3).map((item, index) => <div className={`shelf-item shelf-item--${index}`} key={item.id}><span className="shelf-file-icon"><FileText size={16} /></span><span><strong>{item.name}</strong><small>{item.category}</small></span><span className="shelf-open"><ArrowUpRight size={15} /></span></div>) : <div className="shelf-empty"><FileText size={18} /><span>No materials have been added yet.</span></div>}</div><div className="shelf-bottom"><span><span className="online-dot" /> Shared resources</span><span>CARAGA REGION XIII</span></div></div></section>;
}

function ProgramModal({ onClose, onCreate }: { onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void }) {
  const [sessions, setSessions] = useState<ProgramSession[]>([{ date: "", time: "", session: "", track: "", responsible: "" }]);
  const updateSession = (index: number, key: keyof ProgramSession, value: string) => setSessions((current) => current.map((session, i) => i === index ? { ...session, [key]: value } : session));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="form-modal program-editor" role="dialog" aria-modal="true" aria-label="Create a program"><div className="form-modal-head"><div><span className="eyebrow">PROGRAM EDITOR</span><h2>Build a program<span>.</span></h2><p>Set the event details and add the first sessions to the daily flow.</p></div><button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form autoComplete="off" onSubmit={(event) => { event.preventDefault(); const target = event.currentTarget; const hidden = target.querySelector<HTMLInputElement>("[name=flowJson]"); if (hidden) hidden.value = JSON.stringify(sessions); onCreate(event); }}><input type="hidden" name="flowJson" value={JSON.stringify(sessions)} readOnly /><div className="editor-grid"><Field label="Event title"><input autoComplete="off" name="eventTitle" placeholder="e.g. Regional learning exchange" required /></Field><Field label="Venue"><input autoComplete="off" name="venue" placeholder="City, venue, or online" required /></Field><Field label="Date from"><input autoComplete="off" type="date" name="dateFrom" onChange={(event) => { if (!sessions[0]?.date) updateSession(0, "date", event.target.value); }} required /></Field><Field label="Date to"><input autoComplete="off" type="date" name="dateTo" required /></Field><Field label="Short description"><input autoComplete="off" name="description" placeholder="A short note for participants" /></Field></div><div className="editor-session-head"><div><span className="eyebrow">DAILY PROGRAM FLOW</span><p>Each session has its own date, time, and track.</p></div><button type="button" className="text-action" onClick={() => setSessions((current) => [...current, { date: sessions[0]?.date || "", time: "", session: "", track: "", responsible: "" }])}><Plus size={15} /> Add a session</button></div><div className="session-edit-list">{sessions.map((item, index) => <div className="session-edit-row" key={index}><span className="session-edit-num">{String(index + 1).padStart(2, "0")}</span><input autoComplete="off" aria-label="Session date" type="date" value={item.date} onChange={(event) => updateSession(index, "date", event.target.value)} required /><input autoComplete="off" aria-label="Session time" placeholder="Start and end time" value={item.time} onChange={(event) => updateSession(index, "time", event.target.value)} required /><input autoComplete="off" aria-label="Session title" placeholder="Session title" value={item.session} onChange={(event) => updateSession(index, "session", event.target.value)} required /><select autoComplete="off" aria-label="Session track" required value={item.track} onChange={(event) => updateSession(index, "track", event.target.value)}><option value="" disabled>Select track</option>{tracks.map((track) => <option key={track}>{track}</option>)}</select><input autoComplete="off" aria-label="Responsible person" placeholder="Responsible" value={item.responsible} onChange={(event) => updateSession(index, "responsible", event.target.value)} /><button type="button" aria-label="Remove session" className="remove-session" disabled={sessions.length === 1} onClick={() => setSessions((current) => current.filter((_, i) => i !== index))}><X size={15} /></button></div>)}</div><div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" className="button button--olive">Publish program <ArrowRight size={16} /></button></div></form></div></div>;
}

function MaterialModal({ programs, onClose, onCreate, busy }: { programs: Program[]; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="form-modal material-editor" role="dialog" aria-modal="true" aria-label="Add a material"><div className="form-modal-head"><div><span className="eyebrow">RESOURCE LIBRARY</span><h2>Add a material<span>.</span></h2><p>Link a resource or upload a file for a published program.</p></div><button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form onSubmit={onCreate}><Field label="Program"><select name="programId" required defaultValue="">{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle} · {dateRange(program.dateFrom, program.dateTo)} · {program.venue}</option>)}</select></Field><Field label="Category"><select name="category" defaultValue="Guidelines">{categories.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Material name"><input name="materialName" placeholder="e.g. Participant guide" /></Field><label className="field"><span className="field-label">Upload a file</span><span className="file-picker"><Upload size={18} /><span><strong>Choose a file</strong><small>PDF, presentation, worksheet, or document · up to 16 MB</small></span><input type="file" name="materialFile" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" /></span></label><div className="or-divider"><span>OR ADD A LINK</span></div><Field label="Resource URL"><input type="url" name="materialUrl" placeholder="https://…" /></Field><p className="upload-note"><LockKeyhole size={13} /> Uploads are available to approved members. Public program materials can be viewed without signing in.</p><div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || programs.length === 0} className="button button--olive">{busy ? "Uploading…" : "Add material"}<ArrowRight size={16} /></button></div>{programs.length === 0 && <p className="form-hint">Publish a program before adding its materials.</p>}</form></div></div>;
}

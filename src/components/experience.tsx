"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut, User,
} from "firebase/auth";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Download, Eye,
  EyeOff, FileCheck2, FileText, Filter, Leaf, LockKeyhole, LogOut, Mail, MapPin,
  Menu, Pencil, Plus, Printer, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, UsersRound, X,
} from "lucide-react";
import { auth, db, ContestJoin, ContestMechanics, Material, MaterialCategory, Program, ProgramSession, ResponsiblePerson, SUPERADMIN_EMAIL, UserProfile, UserRole } from "@/lib/firebase";
import { uploadFiles, uploadthingDownloadEndpoint } from "@/lib/uploadthing";

type Section = "home" | "programs" | "contests" | "contestMechanics" | "materials" | "approval" | "manage";
type Track = "Break" | "Breakout" | "Closing" | "Logistics" | "Meeting" | "Opening" | "Plenary";
const tracks: Track[] = ["Break", "Breakout", "Closing", "Logistics", "Meeting", "Opening", "Plenary"];
const categories: MaterialCategory[] = ["Guidelines", "Presentation", "References", "Worksheet"];
const suffixes = ["Jr.", "Sr.", "II", "III", "IV", "V", "VI"];
type DeleteTarget = { kind: "program" | "material" | "mechanics"; id: string; label: string };

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

function nameInitials(person: Partial<UserProfile>) {
  return [person.firstName, person.middleName, person.lastName]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => Array.from(name)[0]?.toLocaleUpperCase() ?? "")
    .join("") || "?";
}

function profileRole(profile: Partial<UserProfile>): UserRole {
  if (profile.email?.toLowerCase() === SUPERADMIN_EMAIL) return "superadmin";
  return profile.role ?? "regular";
}

function philippineGreeting(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Manila",
  }).format(date));
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

function philippineCurrentYear() {
  return Number(new Intl.DateTimeFormat("en-PH", { year: "numeric", timeZone: "Asia/Manila" }).format(new Date()));
}

const emptyResponsiblePerson = (): ResponsiblePerson => ({ name: "", designation: "", office: "" });

function parseTimeValue(value: string | undefined) {
  if (!value) return "";
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 23) return "";
  const period = match[3]?.toUpperCase();
  if (period) {
    if (hour < 1 || hour > 12) return "";
    hour = (hour % 12) + (period === "PM" ? 12 : 0);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sessionTimeRange(item: ProgramSession) {
  let startTime = parseTimeValue(item.startTime);
  let endTime = parseTimeValue(item.endTime);
  if (!startTime || !endTime) {
    const legacyRange = String(item.time ?? "").split(/\s*[–—-]\s*/);
    if (!startTime) startTime = parseTimeValue(legacyRange[0]);
    if (!endTime) endTime = parseTimeValue(legacyRange[1]);
  }
  return { startTime, endTime };
}

function formatTimeValue(value: string) {
  const [hourValue, minute] = value.split(":");
  const hour = Number(hourValue);
  const period = hour >= 12 ? "PM" : "AM";
  return `${String(hour % 12 || 12).padStart(2, "0")}:${minute} ${period}`;
}

function sessionTimeLabel(item: ProgramSession) {
  const { startTime, endTime } = sessionTimeRange(item);
  if (startTime && endTime) return `${formatTimeValue(startTime)} – ${formatTimeValue(endTime)}`;
  return item.time?.trim() || "—";
}

function sessionPeriodLabel(item: ProgramSession) {
  const startTime = sessionTimeRange(item).startTime;
  if (!startTime) return "";
  const [hour, minute] = startTime.split(":").map(Number);
  const minutes = hour * 60 + minute;
  if (minutes < 12 * 60) return "MORNING SESSION";
  if (minutes <= 17 * 60) return "AFTERNOON SESSION";
  return "EVENING SESSION";
}

function responsiblePeople(value: ProgramSession["responsible"]): ResponsiblePerson[] {
  if (Array.isArray(value)) return value.map((person) => ({
    name: String(person?.name ?? ""),
    designation: String(person?.designation ?? ""),
    office: String(person?.office ?? ""),
  }));
  return typeof value === "string" && value.trim() ? [{ name: value.trim(), designation: "", office: "" }] : [];
}

function responsibleSearchText(value: ProgramSession["responsible"]) {
  return responsiblePeople(value).map((person) => `${person.name} ${person.designation} ${person.office}`).join(" ");
}

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function emailVerificationActionSettings() {
  return { url: window.location.origin, handleCodeInApp: false };
}

function materialFilename(material: Material) {
  const name = material.name.trim() || "program-material";
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
  try {
    const pathname = new URL(material.url).pathname;
    const extension = pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1];
    return extension ? `${name}.${extension}` : name;
  } catch { return name; }
}

function isUploadThingFile(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const uploadThingHost = ["ufs.sh", "utfs.io"].some((domain) => host === domain || host.endsWith(`.${domain}`));
    return url.protocol === "https:" && uploadThingHost && url.pathname.startsWith("/f/");
  } catch { return false; }
}

function SessionResponsibleDisplay({ item }: { item: ProgramSession }) {
  if (item.responsibleNotApplicable) return null;
  if (item.allParticipants) return <span className="all-participants-value">All Participants</span>;
  const people = responsiblePeople(item.responsible).filter((person) => person.name || person.designation || person.office);
  if (!people.length) return null;
  return <div className="session-person-list">{people.map((person, personIndex) => <span key={`${person.name}-${personIndex}`}><strong>{person.name || "Responsible"}</strong>{(person.designation || person.office) && <small>{[person.designation, person.office].filter(Boolean).join(" · ")}</small>}</span>)}</div>;
}

function errorText(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "That email and password combination could not be verified.";
  if (code === "auth/email-already-in-use") return "An account already uses this email address. Try signing in instead.";
  if (code === "auth/weak-password") return "Choose a password with at least 6 characters.";
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
  const [contestMechanics, setContestMechanics] = useState<ContestMechanics[]>([]);
  const [contestJoins, setContestJoins] = useState<ContestJoin[]>([]);
  const [contestJoinsLoading, setContestJoinsLoading] = useState(false);
  const [joinedContestIds, setJoinedContestIds] = useState<string[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [section, setSection] = useState<Section>("home");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);
  const [trackFilter, setTrackFilter] = useState<string>("All tracks");
  const [search, setSearch] = useState("");
  const [hoveredTimeGroup, setHoveredTimeGroup] = useState<number | null>(null);
  const [expandedSessionPeriods, setExpandedSessionPeriods] = useState<Set<string>>(() => new Set());
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "create" | "reset">("login");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [programModal, setProgramModal] = useState(false);
  const [contestMechanicsModal, setContestMechanicsModal] = useState(false);
  const [materialModal, setMaterialModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [editingMechanics, setEditingMechanics] = useState<ContestMechanics | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [contestMechanicsLoading, setContestMechanicsLoading] = useState(true);
  const [joiningContestId, setJoiningContestId] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [cloudIssue, setCloudIssue] = useState("");
  const [loading, setLoading] = useState(true);
  const authActionInProgress = useRef(false);

  const isAdmin = Boolean(user && user.emailVerified && (user.email?.toLowerCase() === SUPERADMIN_EMAIL || profileRole(activeProfile ?? {}) === "superadmin"));
  const isApprovedMember = Boolean(user && !isAdmin && activeProfile?.status === "Approved" && user.emailVerified);
  const signedIn = isAdmin || isApprovedMember;
  const currentYear = philippineCurrentYear();
  const currentYearProgram = useMemo(() => {
    const thisYearPrograms = programs.filter((program) => Number(program.dateFrom?.slice(0, 4)) === currentYear);
    return thisYearPrograms.find((program) => /aew congress/i.test(program.eventTitle)) ?? thisYearPrograms[0] ?? null;
  }, [currentYear, programs]);
  useEffect(() => {
    const programYear = Number(currentYearProgram?.dateFrom?.slice(0, 4));
    document.title = `AEW Congress ${programYear || currentYear}`;
  }, [currentYear, currentYearProgram]);
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
      const responsibleSearch = item.allParticipants ? "All Participants" : item.responsibleNotApplicable ? "" : responsibleSearchText(item.responsible);
      const matchesSearch = !needle || `${item.session} ${responsibleSearch} ${item.track}`.toLowerCase().includes(needle);
      return matchesDay && matchesTrack && matchesSearch;
    }).sort((a, b) => {
      const aTime = sessionTimeRange(a);
      const bTime = sessionTimeRange(b);
      return (aTime.startTime || a.time || "").localeCompare(bTime.startTime || b.time || "")
        || aTime.endTime.localeCompare(bTime.endTime);
    });
  }, [days, selectedDay, selectedProgram, search, trackFilter]);

  const scheduleRows = useMemo(() => {
    const rows: { item: ProgramSession; timeRowSpan: number; timeGroup: number; period: string; periodLabel: string }[] = [];
    let timeGroup = 0;
    let previousPeriod = "";
    for (let index = 0; index < filteredSessions.length;) {
      const item = filteredSessions[index];
      const time = sessionTimeRange(item);
      const period = sessionPeriodLabel(item);
      const periodLabel = period && period !== previousPeriod ? period : "";
      if (period) previousPeriod = period;
      let groupEnd = index + 1;
      if (time.startTime && time.endTime) {
        while (groupEnd < filteredSessions.length) {
          const candidate = filteredSessions[groupEnd];
          const candidateTime = sessionTimeRange(candidate);
          if (candidate.date !== item.date || candidateTime.startTime !== time.startTime || candidateTime.endTime !== time.endTime) break;
          groupEnd += 1;
        }
      }
      rows.push({ item, timeRowSpan: groupEnd - index, timeGroup, period, periodLabel });
      for (let groupedIndex = index + 1; groupedIndex < groupEnd; groupedIndex += 1) {
        rows.push({ item: filteredSessions[groupedIndex], timeRowSpan: 0, timeGroup, period, periodLabel: "" });
      }
      index = groupEnd;
      timeGroup += 1;
    }
    return rows;
  }, [filteredSessions]);

  useEffect(() => {
    const stopPrograms = onSnapshot(query(collection(db, "programs"), orderBy("dateFrom", "asc")), (snapshot) => {
      setPrograms(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Program)));
      setCloudIssue("");
      setLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setLoading(false); });
    const stopAuth = onAuthStateChanged(auth, async (current) => {
      if (!current) { setUser(null); setActiveProfile(null); return; }
      // Login and registration handle verification and approval in sequence. Avoid
      // racing those flows with the background session guard.
      if (authActionInProgress.current) { setUser(current); return; }
      try {
        await current.reload();
        await current.getIdToken(true);
      } catch { /* A later sign-in will retry the verification refresh. */ }
      setUser(current);
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
        if (profileRole(profile) === "superadmin") {
          if (!current.emailVerified) {
            await signOut(auth);
            setToast({ kind: "info", text: "Verify your email address before using superadmin tools." });
            return;
          }
          setActiveProfile(profile);
          return;
        }
        if (!current.emailVerified) {
          setActiveProfile(profile);
          setToast({ kind: "info", text: "Verify your email to add your account to the superadmin approval queue." });
          return;
        }
        const verifiedProfile = {
          ...profile,
          emailVerified: true,
          status: profile.status === "Unverified" ? "Pending" as const : profile.status,
        };
        if (profile.emailVerified !== true || verifiedProfile.status !== profile.status) {
          await updateDoc(doc(db, "userProfiles", current.uid), {
            emailVerified: true,
            status: verifiedProfile.status,
          });
        }
        setActiveProfile(verifiedProfile);
        if (verifiedProfile.status !== "Approved") {
          await signOut(auth);
          if (verifiedProfile.status === "Pending") setToast({ kind: "info", text: "Awaiting Approval for Admin. Your verified account is pending admin approval." });
          else if (verifiedProfile.status === "Disapproved") setToast({ kind: "error", text: "This account was not approved. Contact your office administrator for assistance." });
        }
      } catch { setActiveProfile(null); }
    });
    return () => { stopPrograms(); stopAuth(); };
  }, []);

  useEffect(() => {
    if (!user || user.emailVerified) return;
    let checking = false;
    const refreshIfVerified = async () => {
      const current = auth.currentUser;
      if (!current || checking) return;
      checking = true;
      try {
        await current.reload();
        if (!current.emailVerified) return;
        await current.getIdToken(true);
        window.location.reload();
      } catch { /* A later focus or interval check will retry. */ }
      finally { checking = false; }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshIfVerified();
    };
    const interval = window.setInterval(refreshIfVerified, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    void refreshIfVerified();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [user]);

  useEffect(() => {
    if (!signedIn) { setMaterials([]); return; }
    const stopMaterials = onSnapshot(query(collection(db, "materials"), orderBy("createdAt", "desc")), (snapshot) => {
      setMaterials(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Material)));
    }, (error) => setCloudIssue(errorText(error)));
    return stopMaterials;
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setContestMechanics([]);
      setContestMechanicsLoading(false);
      return;
    }
    setContestMechanicsLoading(true);
    const stop = onSnapshot(query(collection(db, "contestMechanics"), orderBy("createdAt", "desc")), (snapshot) => {
      setContestMechanics(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ContestMechanics)));
      setContestMechanicsLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setContestMechanicsLoading(false); });
    return stop;
  }, [signedIn]);

  useEffect(() => {
    if (!isApprovedMember || !user) {
      setJoinedContestIds([]);
      return;
    }
    const stop = onSnapshot(query(collection(db, "contestJoins"), where("uid", "==", user.uid)), (snapshot) => {
      setJoinedContestIds(snapshot.docs.map((entry) => (entry.data() as ContestJoin).contestId));
    }, (error) => setCloudIssue(errorText(error)));
    return stop;
  }, [isApprovedMember, user?.uid]);

  useEffect(() => {
    if (!isAdmin) {
      setContestJoins([]);
      setContestJoinsLoading(false);
      return;
    }
    setContestJoinsLoading(true);
    const stopJoins = onSnapshot(collection(db, "contestJoins"), (snapshot) => {
      setContestJoins(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ContestJoin)));
      setContestJoinsLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setContestJoinsLoading(false); });
    return stopJoins;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) { setProfiles([]); setProfilesLoading(false); return; }
    setProfilesLoading(true);
    const stopProfiles = onSnapshot(query(collection(db, "userProfiles"), orderBy("createdAt", "desc")), (snapshot) => {
      setProfiles(snapshot.docs.map((entry) => entry.data() as UserProfile));
      setProfilesLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setProfilesLoading(false); });
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

  async function downloadMaterial(material: Material) {
    if (!isUploadThingFile(material.url)) {
      const anchor = document.createElement("a");
      anchor.href = material.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.download = materialFilename(material);
      anchor.click();
      setToast({ kind: "info", text: "This is an external resource. Its host controls whether it opens or downloads." });
      return;
    }

    try {
      const url = new URL(uploadthingDownloadEndpoint);
      url.searchParams.set("url", material.url);
      url.searchParams.set("name", materialFilename(material));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("The file could not be downloaded. Please try again.");
      const filename = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const safeFilename = filename ? decodeURIComponent(filename) : materialFilename(material);
      saveDownload(await response.blob(), safeFilename);
      setToast({ kind: "success", text: `Download started: ${safeFilename}` });
    } catch (error) { showError(error); }
  }

  function openProgramEditor(program: Program | null = null) { setEditingProgram(program); setProgramModal(true); }
  function openMaterialEditor(material: Material | null = null) { setEditingMaterial(material); setMaterialModal(true); }
  function openMechanicsEditor(mechanics: ContestMechanics | null = null) { setEditingMechanics(mechanics); setContestMechanicsModal(true); }

  async function getVerifiedSuperadmin() {
    const current = auth.currentUser;
    if (!current) throw new Error("Sign in with a verified superadmin account to make this change.");
    await current.reload();
    const token = await current.getIdTokenResult(true);
    const tokenEmail = String(token.claims.email ?? current.email ?? "").trim().toLowerCase();
    if (token.claims.email_verified !== true) {
      throw new Error("Verify your email address, then sign out and sign in again before making this change.");
    }
    if (tokenEmail !== SUPERADMIN_EMAIL) {
      const profileSnapshot = await getDoc(doc(db, "userProfiles", current.uid));
      if (!profileSnapshot.exists() || profileRole(profileSnapshot.data() as UserProfile) !== "superadmin") {
        throw new Error("Only a verified superadmin can make this change.");
      }
    }
    return current;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    authActionInProgress.current = true;
    let loginUser: User | null = null;
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      loginUser = credential.user;
      await credential.user.reload();
      await credential.user.getIdToken(true);
      if (email === SUPERADMIN_EMAIL) {
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          setToast({ kind: "info", text: "A verification link was sent to the superadmin email address." });
          setAuthOpen(false);
          return;
        }
        setSection("home");
        setAuthOpen(false);
        setToast({ kind: "success", text: "Welcome, Superadmin." });
        return;
      }
      const profileSnapshot = await getDoc(doc(db, "userProfiles", credential.user.uid));
      if (!profileSnapshot.exists()) {
        await signOut(auth);
        throw new Error("We couldn't find a registration for this account. Please create an account first.");
      }
      const profile = profileSnapshot.data() as UserProfile;
      if (profileRole(profile) === "superadmin") {
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          setToast({ kind: "info", text: "Verify your email address before using superadmin tools." });
          setAuthOpen(false);
          return;
        }
        setActiveProfile(profile);
        setSection("home");
        setAuthOpen(false);
        setToast({ kind: "success", text: `Welcome, ${profile.firstName}.` });
        return;
      }
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user, emailVerificationActionSettings());
        setActiveProfile(profile);
        setToast({ kind: "info", text: "Verify your email using the link we sent. It will return you to the app and add your account to the superadmin approval queue." });
        setAuthOpen(false);
        return;
      }
      const verifiedProfile: UserProfile = {
        ...profile,
        emailVerified: true,
        status: profile.status === "Unverified" ? "Pending" : profile.status,
      };
      if (profile.emailVerified !== true || verifiedProfile.status !== profile.status) {
        await updateDoc(doc(db, "userProfiles", credential.user.uid), {
          emailVerified: true,
          status: verifiedProfile.status,
        });
      }
      setActiveProfile(verifiedProfile);
      if (verifiedProfile.status === "Pending") {
        await signOut(auth);
        setToast({ kind: "info", text: "Awaiting Approval for Admin. Your verified account is pending admin approval." });
        setAuthOpen(false);
        return;
      }
      if (verifiedProfile.status === "Disapproved") {
        await signOut(auth);
        setToast({ kind: "error", text: "This account was not approved. Contact your office administrator for assistance." });
        setAuthOpen(false);
        return;
      }
      setSection("home");
      setAuthOpen(false);
      setToast({ kind: "success", text: `Welcome back, ${verifiedProfile.firstName}.` });
    } catch (error) {
      if (loginUser && auth.currentUser?.uid === loginUser.uid) await signOut(auth).catch(() => undefined);
      showError(error);
    }
    finally { authActionInProgress.current = false; }
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
    if (password.length < 6) { setToast({ kind: "error", text: "Choose a password with at least 6 characters." }); return; }
    if (phone.length !== 9) { setToast({ kind: "error", text: "Enter the 9 digits after +63 9." }); return; }
    authActionInProgress.current = true;
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
        role: "regular",
        emailVerified: false,
        status: "Unverified",
        createdAt: serverTimestamp(),
      };
      await (await import("firebase/firestore")).setDoc(doc(db, "userProfiles", credential.user.uid), profile);
      await sendEmailVerification(credential.user, emailVerificationActionSettings());
      formElement.reset();
      setAuthMode("login");
      setAuthOpen(false);
      setToast({ kind: "success", text: "Verification link has been sent. Verify it in this browser to return to the app and add your account to the superadmin approval queue." });
    } catch (error) {
      if (auth.currentUser?.email?.toLowerCase() === email) await signOut(auth).catch(() => undefined);
      showError(error);
    }
    finally { authActionInProgress.current = false; }
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

  async function changeRole(profile: UserProfile, role: UserRole) {
    if (profile.email.toLowerCase() === SUPERADMIN_EMAIL && role !== "superadmin") {
      setToast({ kind: "error", text: "The primary superadmin role cannot be removed." });
      return;
    }
    try {
      await updateDoc(doc(db, "userProfiles", profile.uid), { role, roleUpdatedAt: serverTimestamp() });
      if (profile.uid === user?.uid) setActiveProfile({ ...profile, role });
      setToast({ kind: "success", text: `${fullName(profile)} is now ${role}.` });
    } catch (error) { showError(error); }
  }

  async function createProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !isAdmin) {
      setProgramModal(false);
      setToast({ kind: "error", text: "Sign in with a verified superadmin account to publish programs." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const flow = (JSON.parse(String(form.get("flowJson"))) as ProgramSession[]).map((item) => {
      const normalized = { ...item };
      delete normalized.time;
      return { ...normalized, ...sessionTimeRange(item), responsible: responsiblePeople(item.responsible) };
    });
    const payload = {
      eventTitle: String(form.get("eventTitle")).trim(),
      theme: String(form.get("theme") ?? "").trim(),
      dateFrom: String(form.get("dateFrom")),
      dateTo: String(form.get("dateTo")),
      venue: String(form.get("venue")).trim(),
      description: String(form.get("description")).trim(),
      flow,
      createdAt: serverTimestamp(),
    };
    if (payload.dateTo < payload.dateFrom) { setToast({ kind: "error", text: "The end date must be on or after the start date." }); return; }
    try {
      const adminUser = await getVerifiedSuperadmin();
      if (editingProgram) {
        const [materialSnapshot, mechanicsSnapshot] = await Promise.all([
          getDocs(query(collection(db, "materials"), where("programId", "==", editingProgram.id))),
          getDocs(query(collection(db, "contestMechanics"), where("programId", "==", editingProgram.id))),
        ]);
        const updates = [
          { collectionName: "programs", id: editingProgram.id, data: { ...payload, updatedAt: serverTimestamp() } },
          ...materialSnapshot.docs.map((entry) => ({ collectionName: "materials", id: entry.id, data: { programTitle: payload.eventTitle, updatedAt: serverTimestamp() } })),
          ...mechanicsSnapshot.docs.map((entry) => ({ collectionName: "contestMechanics", id: entry.id, data: { eventTitle: payload.eventTitle, dateFrom: payload.dateFrom, dateTo: payload.dateTo, venue: payload.venue, updatedAt: serverTimestamp() } })),
        ];
        for (let start = 0; start < updates.length; start += 450) {
          const batch = writeBatch(db);
          updates.slice(start, start + 450).forEach((entry) => batch.update(doc(db, entry.collectionName, entry.id), entry.data));
          await batch.commit();
        }
        setSelectedProgramId(editingProgram.id);
        setToast({ kind: "success", text: "Program updated." });
      } else {
        const created = await addDoc(collection(db, "programs"), { ...payload, createdBy: adminUser.uid });
        setSelectedProgramId(created.id);
        setToast({ kind: "success", text: "Program published." });
      }
      setSection("programs");
      setProgramModal(false);
      setEditingProgram(null);
    } catch (error) {
      if ((error as { code?: string })?.code === "permission-denied") {
        const current = auth.currentUser;
        const token = current ? await current.getIdTokenResult() : null;
        const actualEmail = String(token?.claims.email ?? current?.email ?? "no signed-in account");
        const verified = token?.claims.email_verified === true;
        setToast({ kind: "error", text: `Firestore rejected this program write for ${actualEmail} (verified email: ${verified ? "yes" : "no"}). The required superadmin is ${SUPERADMIN_EMAIL}.` });
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
    let adminUser: User;
    try { adminUser = await getVerifiedSuperadmin(); }
    catch (error) { showError(error); return; }
    const targetProgram = programs.find((program) => program.id === String(form.get("programId")));
    if (!targetProgram) { setToast({ kind: "error", text: "Choose a published program for this material." }); return; }
    const file = form.get("materialFile");
    const externalUrl = String(form.get("materialUrl")).trim();
    const category = String(form.get("category")) as MaterialCategory;
    let url = externalUrl || editingMaterial?.url || "";
    let name = String(form.get("materialName")).trim() || editingMaterial?.name || "";
    if (file instanceof File && file.size > 0) {
      setUploadBusy(true);
      try {
        const result = await uploadFiles("materialUploader", {
          files: [file],
          headers: async () => ({ Authorization: `Bearer ${await adminUser.getIdToken()}` }),
        });
        url = result[0]?.ufsUrl ?? "";
        name = name || file.name;
      } catch (error) { setUploadBusy(false); showError(error); return; }
      setUploadBusy(false);
    }
    if (!url) { setToast({ kind: "error", text: "Add a resource link or choose a file to upload." }); return; }
    try {
      const payload = {
        programId: targetProgram.id,
        programTitle: targetProgram.eventTitle,
        category,
        name: name || url.split("/").pop() || "Program resource",
        url,
        updatedAt: serverTimestamp(),
      };
      if (editingMaterial) {
        await updateDoc(doc(db, "materials", editingMaterial.id), payload);
      } else {
        await addDoc(collection(db, "materials"), { ...payload, createdAt: serverTimestamp(), createdBy: adminUser.uid });
      }
      formElement.reset();
      setMaterialModal(false);
      setEditingMaterial(null);
      setToast({ kind: "success", text: editingMaterial ? "Material updated." : "Material added to the resource library." });
    } catch (error) { showError(error); }
  }

  async function createContestMechanics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !isAdmin) {
      setContestMechanicsModal(false);
      setToast({ kind: "error", text: "Sign in with a verified superadmin account to add contest mechanics." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const program = programs.find((item) => item.id === String(form.get("programId")));
    if (!program) { setToast({ kind: "error", text: "Choose a published program for these mechanics." }); return; }
    const contest = String(form.get("contest")).trim().replace(/\s+/g, " ");
    let criteria: Array<{ criteria: string; description: string; weight: number }>;
    try {
      const rows = JSON.parse(String(form.get("criteriaRows"))) as Array<{ criteria?: unknown; description?: unknown; weight?: unknown }>;
      criteria = rows.map((row) => ({
        criteria: String(row.criteria ?? "").trim(),
        description: String(row.description ?? "").trim(),
        weight: String(row.weight ?? "").trim() ? Number(row.weight) : Number.NaN,
      }));
    } catch {
      criteria = [];
    }
    if (!contest || !criteria.length || criteria.some((row) => !row.criteria || !row.description || !Number.isFinite(row.weight) || row.weight < 0)) {
      setToast({ kind: "error", text: "Complete every criteria row and enter a non-negative weight for each." });
      return;
    }
    const contestId = `${program.id}_${encodeURIComponent(contest.toLowerCase())}`;
    try {
      const adminUser = await getVerifiedSuperadmin();
      if (editingMechanics) {
        const joins = await getDocs(query(collection(db, "contestJoins"), where("contestId", "==", editingMechanics.id)));
        const updates = [
          { collectionName: "contestMechanics", id: editingMechanics.id, data: { programId: program.id, eventTitle: program.eventTitle, dateFrom: program.dateFrom, dateTo: program.dateTo, venue: program.venue, contest, criteria, updatedAt: serverTimestamp() } },
          ...joins.docs.map((entry) => ({ collectionName: "contestJoins", id: entry.id, data: { programId: program.id, contest, updatedAt: serverTimestamp() } })),
        ];
        for (let start = 0; start < updates.length; start += 450) {
          const batch = writeBatch(db);
          updates.slice(start, start + 450).forEach((entry) => batch.update(doc(db, entry.collectionName, entry.id), entry.data));
          await batch.commit();
        }
        setToast({ kind: "success", text: `Mechanics for ${contest} updated.` });
      } else {
        const programMechanics = await getDocs(query(collection(db, "contestMechanics"), where("programId", "==", program.id)));
        const matching = programMechanics.docs.find((entry) => String(entry.data().contest ?? "").trim().toLowerCase() === contest.toLowerCase());
        const mechanicsRef = doc(db, "contestMechanics", matching?.id ?? contestId);
        await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(mechanicsRef);
          if (existing.exists()) {
            const current = existing.data() as ContestMechanics;
            transaction.update(mechanicsRef, {
              criteria: [...(Array.isArray(current.criteria) ? current.criteria : []), ...criteria],
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.set(mechanicsRef, {
              programId: program.id,
              eventTitle: program.eventTitle,
              dateFrom: program.dateFrom,
              dateTo: program.dateTo,
              venue: program.venue,
              contest,
              criteria,
              createdAt: serverTimestamp(),
              createdBy: adminUser.uid,
            });
          }
        });
        setToast({ kind: "success", text: `Mechanics added to ${contest}.` });
      }
      setContestMechanicsModal(false);
      setEditingMechanics(null);
    } catch (error) { showError(error); }
  }

  async function joinContest(contest: ContestMechanics) {
    if (!user || !isApprovedMember) {
      setToast({ kind: "error", text: "An approved, verified member account is required to join a contest." });
      return;
    }
    if (joinedContestIds.includes(contest.id)) return;
    setJoiningContestId(contest.id);
    try {
      await user.getIdToken(true);
      const joinId = `${contest.id}_${user.uid}`;
      await setDoc(doc(db, "contestJoins", joinId), {
        contestId: contest.id,
        programId: contest.programId,
        contest: contest.contest,
        uid: user.uid,
        joinedAt: serverTimestamp(),
      });
      setJoinedContestIds((current) => current.includes(contest.id) ? current : [...current, contest.id]);
      setToast({ kind: "success", text: `You joined ${contest.contest}.` });
    } catch (error) {
      if ((error as { code?: string })?.code === "permission-denied") {
        setToast({ kind: "error", text: "Could not join. Confirm your account is approved and the latest Firestore rules are deployed." });
      } else showError(error);
    } finally { setJoiningContestId(""); }
  }

  async function deleteContent() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await getVerifiedSuperadmin();
      let refs: Array<{ collectionName: string; id: string }> = [];
      if (deleteTarget.kind === "program") {
        const [materialDocs, mechanicsDocs, joinDocs] = await Promise.all([
          getDocs(query(collection(db, "materials"), where("programId", "==", deleteTarget.id))),
          getDocs(query(collection(db, "contestMechanics"), where("programId", "==", deleteTarget.id))),
          getDocs(query(collection(db, "contestJoins"), where("programId", "==", deleteTarget.id))),
        ]);
        refs = [
          { collectionName: "programs", id: deleteTarget.id },
          ...materialDocs.docs.map((entry) => ({ collectionName: "materials", id: entry.id })),
          ...mechanicsDocs.docs.map((entry) => ({ collectionName: "contestMechanics", id: entry.id })),
          ...joinDocs.docs.map((entry) => ({ collectionName: "contestJoins", id: entry.id })),
        ];
      } else if (deleteTarget.kind === "mechanics") {
        const joinDocs = await getDocs(query(collection(db, "contestJoins"), where("contestId", "==", deleteTarget.id)));
        refs = [
          { collectionName: "contestMechanics", id: deleteTarget.id },
          ...joinDocs.docs.map((entry) => ({ collectionName: "contestJoins", id: entry.id })),
        ];
      } else {
        refs = [{ collectionName: "materials", id: deleteTarget.id }];
      }
      for (let start = 0; start < refs.length; start += 450) {
        const batch = writeBatch(db);
        refs.slice(start, start + 450).forEach((entry) => batch.delete(doc(db, entry.collectionName, entry.id)));
        await batch.commit();
      }
      if (deleteTarget.kind === "program") {
        setToast({ kind: "success", text: "Program and its related materials, contests, and joins were deleted." });
      } else if (deleteTarget.kind === "mechanics") {
        setToast({ kind: "success", text: "Contest mechanics and associated joins were deleted." });
      } else {
        setToast({ kind: "success", text: "Material removed from the library." });
      }
      setDeleteTarget(null);
    } catch (error) { showError(error); }
    finally { setDeleteBusy(false); }
  }

  async function logout() {
    await signOut(auth);
    setSection("home");
    setMobileMenuOpen(false);
    setToast({ kind: "success", text: "You have signed out." });
  }

  const navItems: { id: Section; label: string }[] = [
    ...(isApprovedMember ? [{ id: "programs" as Section, label: "Programs" }] : []),
    ...(isApprovedMember ? [{ id: "contests" as Section, label: "Contest" }] : []),
    ...(isAdmin ? [{ id: "contestMechanics" as Section, label: "Contest Mechanics" }] : []),
    ...(signedIn ? [{ id: "materials" as Section, label: "Materials" }] : []),
    ...(isAdmin ? [{ id: "manage" as Section, label: "Manage content" }] : []),
    ...(isAdmin ? [{ id: "approval" as Section, label: "User approval" }] : []),
  ];

  return (
    <div className="site-shell">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="AEW Congress home" onClick={(event) => { event.preventDefault(); setSection("home"); }}>
          <span className="brand-mark"><img src="/AEW_logo_1.png" alt="" /></span>
          <span className="brand-wording"><strong>AEW <em>CONGRESS</em></strong><small>CARAGA REGION</small></span>
        </a>
        {signedIn && <nav className={`primary-nav ${mobileMenuOpen ? "primary-nav--open" : ""}`} aria-label="Primary navigation">
          {navItems.map((item) => <button key={item.id} className={section === item.id ? "nav-link nav-link--active" : "nav-link"} onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}>{item.label}{item.id === "approval" && profiles.filter((p) => p.emailVerified === true && p.status === "Pending").length > 0 && <span className="nav-count">{profiles.filter((p) => p.emailVerified === true && p.status === "Pending").length}</span>}</button>)}
        </nav>}
        <div className="topbar-actions">
          {signedIn ? <><span className="signed-in-label"><span className="online-dot" />{isAdmin ? "Superadmin" : activeProfile?.firstName}</span><IconButton label="Sign out" onClick={logout}><LogOut size={18} /></IconButton></> : <button className="login-link" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}><span>Log in</span><span className="login-icon"><UserRound size={17} /></span></button>}
          {signedIn && <button className="mobile-menu-button" aria-label="Toggle navigation" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>}
        </div>
      </header>

      <main id="top">
        {section === "approval" && isAdmin ? (
          <ApprovalDashboard profiles={profiles} loading={loading} onChangeRole={changeRole} onChangeStatus={changeStatus} onAddProgram={() => openProgramEditor()} onAddMaterial={() => openMaterialEditor()} />
        ) : section === "manage" && isAdmin ? (
          <ManageDashboard programs={programs} materials={materials} mechanics={contestMechanics} onAddProgram={() => openProgramEditor()} onEditProgram={openProgramEditor} onDeleteProgram={(program) => setDeleteTarget({ kind: "program", id: program.id, label: program.eventTitle })} onAddMaterial={() => openMaterialEditor()} onEditMaterial={openMaterialEditor} onDeleteMaterial={(material) => setDeleteTarget({ kind: "material", id: material.id, label: material.name })} onEditMechanics={openMechanicsEditor} onDeleteMechanics={(mechanics) => setDeleteTarget({ kind: "mechanics", id: mechanics.id, label: mechanics.contest })} onAddMechanics={() => openMechanicsEditor()} onBack={() => setSection("approval")} />
        ) : section === "contestMechanics" && isAdmin ? (
          <ContestMechanicsPage mechanics={contestMechanics} joins={contestJoins} profiles={profiles} contestantsLoading={contestJoinsLoading || profilesLoading} programs={programs} loading={contestMechanicsLoading} onAdd={() => openMechanicsEditor()} onEdit={openMechanicsEditor} onDelete={(mechanics) => setDeleteTarget({ kind: "mechanics", id: mechanics.id, label: mechanics.contest })} />
        ) : section === "contests" && isApprovedMember ? (
          <ContestsPage contests={contestMechanics} joinedContestIds={joinedContestIds} joiningContestId={joiningContestId} loading={contestMechanicsLoading} onJoin={joinContest} />
        ) : section === "materials" ? (
          <MaterialsPage materials={materials} programs={programs} isAdmin={isAdmin} onAdd={() => openMaterialEditor()} onDownload={downloadMaterial} loading={loading} />
        ) : (
          <>
            {section === "home" && <HomeLanding program={currentYearProgram} currentYear={currentYear} loading={loading} onExplorePrograms={() => setSection("programs")} onMemberAccess={() => { if (signedIn) setSection("materials"); else { setAuthMode("login"); setAuthOpen(true); } }} />}

            {section === "programs" && <>
            <section className="content-wrap program-section" id="program-list">
              <div className="section-heading"><div><span className="eyebrow">THE CALENDAR</span><h2>Programs <span>& gatherings</span></h2></div><div className="heading-side"><span className="section-count">{programs.length.toString().padStart(2, "0")} <span>PROGRAMS</span></span>{isAdmin && <button className="button button--soft" onClick={() => openProgramEditor()}><Plus size={16} /> New program</button>}</div></div>
              <div className="program-cards">
                {programs.map((program, index) => <button key={program.id} className={`program-card ${selectedProgram?.id === program.id ? "program-card--selected" : ""}`} onClick={() => { setSelectedProgramId(program.id); setSelectedDay(0); }}>
                  <span className={`program-card-num program-card-num--${index % 3}`}>{String(index + 1).padStart(2, "0")}</span><div className="program-card-main"><span className="card-date"><CalendarDays size={13} />{dateRange(program.dateFrom, program.dateTo)}</span><h3>{program.eventTitle}</h3>{program.theme && <span className="program-card-theme">{program.theme}</span>}<span className="card-location"><MapPin size={13} />{program.venue}</span></div><span className="program-card-arrow"><ArrowUpRight size={18} /></span>
                </button>)}
              </div>
              {!programs.length && <div className="program-empty"><CalendarDays size={22} /><div><strong>{loading ? "Loading programs..." : "No programs have been published yet."}</strong><span>{loading ? "Published programs will appear here." : isAdmin ? "Add a program to share it with the community." : "Please check back later for upcoming programs."}</span></div>{isAdmin && !loading && <button className="button button--soft" onClick={() => openProgramEditor()}><Plus size={16} /> New program</button>}</div>}
            </section>

            {selectedProgram ? <section className="content-wrap schedule-section" id="schedule">
              <div className="schedule-topline"><div className="schedule-kicker"><span className="live-pill"><span />PROGRAM FLOW</span><span className="schedule-location"><MapPin size={13} />{selectedProgram?.venue}</span></div><div className="schedule-tools"><label className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions or people" aria-label="Search sessions or people" /><kbd>⌘ K</kbd></label><label className="filter-select"><Filter size={14} /><select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} aria-label="Filter by track"><option>All tracks</option>{tracks.map((track) => <option key={track}>{track}</option>)}</select><ChevronDown size={13} /></label></div></div>
              <div className="schedule-title-row"><div><span className="eyebrow">THE DAILY FLOW</span><h2>{selectedProgram?.eventTitle}</h2>{selectedProgram?.theme && <p className="schedule-theme"><strong>Theme</strong>{selectedProgram.theme}</p>}<p>{selectedProgram?.description || `${dateRange(selectedProgram?.dateFrom ?? "", selectedProgram?.dateTo ?? "")} · ${selectedProgram?.flow.length ?? 0} sessions`}</p></div><div className="day-controls"><button className="day-arrow" aria-label="Previous day" disabled={selectedDay === 0} onClick={() => setSelectedDay(Math.max(0, selectedDay - 1))}><ChevronLeft size={17} /></button><div className="day-tabs">{days.map((day, index) => <button key={day} className={selectedDay === index ? "day-tab day-tab--active" : "day-tab"} onClick={() => setSelectedDay(index)}><span>DAY {String(index + 1).padStart(2, "0")}</span><small>{displayDate(day, { month: "short", day: "numeric" })}</small></button>)}</div><button className="day-arrow" aria-label="Next day" disabled={selectedDay >= days.length - 1} onClick={() => setSelectedDay(Math.min(days.length - 1, selectedDay + 1))}><ChevronRight size={17} /></button></div></div>
              <div className="schedule-meta"><span><CalendarDays size={15} />{displayDate(days[selectedDay] ?? "")}</span><span><Clock3 size={15} />{filteredSessions.length} sessions today</span><button onClick={() => { setTrackFilter("All tracks"); setSearch(""); }}>Reset filters <X size={12} /></button></div>
              <div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>TIME</th><th>SESSION</th><th>TRACK</th><th>RESPONSIBLE</th></tr></thead><tbody>
                {scheduleRows.map(({ item, timeRowSpan, timeGroup, period, periodLabel }, index) => {
                  const periodKey = `${selectedProgram.id}:${item.date}:${period}`;
                  const periodExpanded = !period || expandedSessionPeriods.has(periodKey);
                  return <Fragment key={`${item.date}-${item.startTime ?? item.time}-${item.session}-${index}`}>
                    {periodLabel && <tr className="session-period-row"><th colSpan={4} scope="rowgroup"><button type="button" aria-expanded={periodExpanded} onClick={() => setExpandedSessionPeriods((current) => {
                      const next = new Set(current);
                      if (next.has(periodKey)) next.delete(periodKey);
                      else next.add(periodKey);
                      return next;
                    })}><ChevronRight size={14} />{periodLabel}</button></th></tr>}
                    {periodExpanded && <tr className={`session-row${hoveredTimeGroup === timeGroup ? " session-row--group-hovered" : ""}`} onMouseEnter={() => setHoveredTimeGroup(timeGroup)} onMouseLeave={() => setHoveredTimeGroup((current) => current === timeGroup ? null : current)} style={{ animationDelay: `${index * 45}ms` }}>{timeRowSpan > 0 && <td className="session-time" rowSpan={timeRowSpan}>{sessionTimeLabel(item)}</td>}<td className="session-name">{item.session}</td><td><span className={`track-pill ${trackColors[item.track] || ""}`}><span />{item.track}</span></td><td className="session-person"><SessionResponsibleDisplay item={item} /></td></tr>}
                  </Fragment>;
                })}
                {!filteredSessions.length && <tr><td colSpan={4} className="empty-table"><Search size={19} /><strong>No matching sessions</strong><span>Try another search or clear the selected track.</span></td></tr>}
              </tbody></table></div>
              <div className="schedule-footer"><span><span className="footer-spark">✳</span>Every session is a chance to share what works.</span><button aria-label="Print schedule" title="Print the schedule or save as PDF" onClick={() => window.print()}><Printer size={15} /> Print</button></div>
            </section> : <section className="content-wrap schedule-empty" id="schedule"><CalendarDays size={23} /><span className="eyebrow">PROGRAM FLOW</span><h2>{loading ? "Loading program flow..." : "No program flow available yet."}</h2><p>{loading ? "The daily schedule will appear when program data loads." : "A daily schedule will appear here after a program is published."}</p>{isAdmin && !loading && <button className="button button--olive" onClick={() => openProgramEditor()}><Plus size={16} /> Create a program</button>}</section>}

            {signedIn && <MaterialsTeaser materials={materials} onOpen={() => setSection("materials")} onDownload={downloadMaterial} />}
            {cloudIssue && <div className="content-wrap cloud-notice"><CircleHelp size={16} /><span>Live data isn’t connected yet. {cloudIssue === "Missing or insufficient permissions." ? "Add the provided Firestore rules and enable sign-in in Firebase." : cloudIssue}</span></div>}
            </>}
          </>
        )}
      </main>

      {section !== "home" && <footer className="footer content-wrap"><span className="footer-copy">© {new Date().getFullYear()} AEW Congress <i>·</i> For extension workers, by extension workers.</span><a href="#top" className="back-top">BACK TO TOP <ArrowUpRight size={14} /></a></footer>}

      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onLogin={handleLogin} onCreate={handleCreateAccount} onForgot={handleForgotPassword} />}
      {programModal && <ProgramModal key={editingProgram?.id ?? "new-program"} initialProgram={editingProgram} onClose={() => { setProgramModal(false); setEditingProgram(null); }} onCreate={createProgram} />}
      {contestMechanicsModal && <ContestMechanicsModal key={editingMechanics?.id ?? "new-mechanics"} programs={programs} initialMechanics={editingMechanics} onClose={() => { setContestMechanicsModal(false); setEditingMechanics(null); }} onCreate={createContestMechanics} />}
      {materialModal && <MaterialModal key={editingMaterial?.id ?? "new-material"} programs={programs} initialMaterial={editingMaterial} onClose={() => { setMaterialModal(false); setEditingMaterial(null); }} onCreate={createMaterial} busy={uploadBusy} />}
      {deleteTarget && <DeleteConfirmModal target={deleteTarget} busy={deleteBusy} onClose={() => !deleteBusy && setDeleteTarget(null)} onConfirm={deleteContent} />}
      {toast && <div className={`toast toast--${toast.kind}`} role="status"><span className="toast-icon">{toast.kind === "success" ? <Check size={15} /> : toast.kind === "info" ? <CircleHelp size={15} /> : <X size={15} />}</span>{toast.text}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}

function HomeLanding({ program, currentYear, loading, onExplorePrograms, onMemberAccess }: { program: Program | null; currentYear: number; loading: boolean; onExplorePrograms: () => void; onMemberAccess: () => void }) {
  const eventTitle = program?.eventTitle || `AEW Congress ${currentYear}`;
  const eventDates = program?.dateFrom && program?.dateTo
    ? dateRange(program.dateFrom, program.dateTo)
    : loading ? "Loading this year’s program…" : "Dates to be announced";
  const eventVenue = program?.venue || (loading ? "Loading venue…" : "Venue to be announced");
  const eventTheme = program?.theme || (loading ? "Loading this year’s theme…" : "Theme to be announced");
  const objectives = [
    { icon: BadgeCheck, title: "Honoring & Acknowledging Frontliners", description: "Recognize the people connecting institutions, programs, and local communities." },
    { icon: Sparkles, title: "Capacity Building & Knowledge Updates", description: "Bring current research, practices, and useful tools into extension work." },
    { icon: ShieldCheck, title: "Policy & Welfare Discussions", description: "Create space for policies, working conditions, and the support AEWs need." },
    { icon: UsersRound, title: "Strengthening Networks & Coordination", description: "Connect agencies, research institutions, and local practitioners across the region." },
  ];

  return <div className="landing-page">
    <section className="landing-hero">
      <div className="content-wrap landing-hero-inner">
        <div className="landing-hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" />DA-RFO XIII · {eventTitle.toUpperCase()}</span>
          <h1>Recognizing the people who help agriculture <span>thrive.</span></h1>
          <p><strong>Agricultural Extension Worker (AEW) Congress</strong> recognizes, empowers, and supports agricultural and fishery extension workers—the vital frontliners connecting research institutions and government agencies with local farming and fishing communities.</p>
          <div className="landing-hero-actions">
            <button className="button button--olive" onClick={onExplorePrograms}>Explore the program <ArrowRight size={16} /></button>
            <button className="text-action" onClick={onMemberAccess}>Member access <ArrowRight size={16} /></button>
          </div>
          <div className="landing-event-facts">
            <div className="landing-event-fact"><span className="landing-fact-icon"><CalendarDays size={18} /></span><span><small>CONGRESS DATES</small><strong>{eventDates}</strong></span></div>
            <div className="landing-event-fact"><span className="landing-fact-icon"><MapPin size={18} /></span><span><small>VENUE</small><strong>{eventVenue}</strong></span></div>
          </div>
        </div>
        <figure className="landing-hero-photo">
          <img src="/p1.jpg" alt="An agricultural extension worker speaking at a congress" />
          <span className="landing-photo-badge"><strong>AEW CONGRESS</strong><small>CARAGA REGION XIII</small></span>
          <figcaption><span>RECOGNIZE · EMPOWER · SUPPORT</span><strong>Frontliners bridging knowledge and community</strong></figcaption>
        </figure>
        <div className="landing-theme-banner"><span className="landing-theme-icon"><Sparkles size={18} /></span><span className="landing-theme-copy"><small>CURRENT YEAR · {currentYear} THEME</small><strong>{eventTheme}</strong></span><span className="landing-theme-year">{currentYear}</span></div>
      </div>
    </section>

    <section className="landing-objectives content-wrap">
      <div className="landing-section-heading"><div><span className="eyebrow">WHY WE GATHER</span><h2>Stronger support for the people<br /><span>serving our communities.</span></h2></div><p>AEWs bridge research, government services, and the everyday needs of farming and fishing communities. The Congress brings that work into focus.</p></div>
      <div className="landing-objective-grid">{objectives.map(({ icon: Icon, title, description }, index) => <article className="landing-objective-card" key={title}><span className="landing-objective-number">{String(index + 1).padStart(2, "0")}</span><span className="landing-objective-icon"><Icon size={19} /></span><h3>{title}</h3><p>{description}</p></article>)}</div>
    </section>

    <section className="landing-gallery content-wrap">
      <div className="landing-gallery-heading"><div><span className="eyebrow">A COMMUNITY IN ACTION</span><h2>Learning, sharing, <span>moving forward.</span></h2></div><p>Every Congress creates room for recognition, new ideas, open discussion, and stronger regional connections.</p></div>
      <div className="landing-gallery-grid">
        <figure className="landing-gallery-card"><img src="/p2.jpg" alt="A speaker addresses agricultural extension workers at a congress" /><figcaption><span>KNOWLEDGE SHARED</span><strong>Learning from one another</strong></figcaption></figure>
        <figure className="landing-gallery-card"><img src="/p3.jpg" alt="Agricultural extension workers gathered for a regional congress" /><figcaption><span>REGIONAL CONNECTIONS</span><strong>Stronger together</strong></figcaption></figure>
      </div>
    </section>
  </div>;
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
  const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="auth-modal" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create an account" : mode === "reset" ? "Reset your password" : "Log in"}>
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
      <div className="auth-side auth-side--form">
        <div className="auth-mobile-brand"><img src="/AEW_logo_1.png" alt="AEW" /><span>AEW <strong>CONGRESS</strong></span></div>
        <div className="auth-heading"><span className="eyebrow">{mode === "create" ? "JOIN THE COMMUNITY" : mode === "reset" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</span><h2>{mode === "create" ? <>Create your<br />account<span>.</span></> : mode === "reset" ? <>Reset your<br />password<span>.</span></> : <>Your next chapter<br />starts here<span>.</span></>}</h2><p>{mode === "create" ? "Register once your office is ready to join the learning exchange." : mode === "reset" ? "We’ll send a secure reset link to the email on your account." : "Sign in to access your programs and shared materials."}</p></div>
        {mode === "login" ? <form className="auth-form login-form" onSubmit={onLogin}>
          <Field label="Email address" icon={<UserRound size={15} />}><input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@office.gov.ph" required /></Field>
          <Field label="Password" icon={<LockKeyhole size={15} />}><input type={showPassword ? "text" : "password"} name="password" autoComplete="current-password" placeholder="Enter your password" required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></Field>
          <div className="auth-form-row"><span className="secure-note"><ShieldCheck size={13} /> Protected access</span><button type="button" className="forgot-link" onClick={() => setMode("reset")}>Forgot password?</button></div>
          <button className="button button--olive button--wide" type="submit">Log in <ArrowRight size={16} /></button>
          <p className="auth-switch">New to AEW Congress? <button type="button" onClick={() => setMode("create")}>Create an account</button></p>
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
          <div className="form-grid form-grid--three"><Field label="Email address"><input type="email" name="email" autoComplete="email" placeholder="you@office.gov.ph" required /></Field><Field label="Password"><div className="password-field"><input type={showPassword ? "text" : "password"} name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field><Field label="Confirm password"><div className="password-field"><input type={showConfirmation ? "text" : "password"} name="confirmation" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Re-enter password" required /><button className="password-toggle" type="button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? "Hide password" : "Show password"}>{showConfirmation ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field></div>
          <p className="privacy-note"><LockKeyhole size={13} /> Registration details are visible only to authorized administrators.</p>
          <button className="button button--olive button--wide" type="submit">Submit for approval <ArrowRight size={16} /></button>
          <p className="auth-switch">Already registered? <button type="button" onClick={() => setMode("login")}>Log in</button></p>
        </form>}
      </div>
      <aside className="auth-side auth-side--art"><div className="auth-art-top"><span>AEW</span><span>CONGRESS<br />REGION XIII</span></div><div className="auth-orbit"><div className="orbit-circle orbit-circle--one" /><div className="orbit-circle orbit-circle--two" /><div className="orbit-circle orbit-circle--three" /><span className="orbit-seed orbit-seed--one" /><span className="orbit-seed orbit-seed--two" /><div className="orbit-core"><img src="/AEW_logo.png" alt="AEW Congress" /></div></div><div className="auth-quote"><span>“</span><p>Better knowledge.<br /><i>Stronger communities.</i></p><small>AGRICULTURAL EXTENSION WORKERS · CARAGA</small></div><div className="auth-side-foot"><span>LEARN · SHARE · GROW</span></div></aside>
    </div>
  </div>;
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{icon}{label}</span><span className="field-control">{children}</span></label>;
}

function ApprovalDashboard({ profiles, loading, onChangeRole, onChangeStatus, onAddProgram, onAddMaterial }: {
  profiles: UserProfile[]; loading: boolean; onChangeRole: (profile: UserProfile, role: UserRole) => void; onChangeStatus: (profile: UserProfile, status: UserProfile["status"]) => void; onAddProgram: () => void; onAddMaterial: () => void;
}) {
  const [filter, setFilter] = useState("Pending");
  const [philippineNow, setPhilippineNow] = useState<Date | null>(null);
  useEffect(() => {
    const refreshClock = () => setPhilippineNow(new Date());
    refreshClock();
    const interval = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const verifiedProfiles = profiles.filter((profile) => profile.emailVerified === true);
  const filtered = verifiedProfiles.filter((profile) => filter === "All" || profile.status === filter).sort((a, b) => (a.status === "Pending" ? -1 : 1));
  const counts = { Pending: verifiedProfiles.filter((p) => p.status === "Pending").length, Approved: verifiedProfiles.filter((p) => p.status === "Approved").length, Disapproved: verifiedProfiles.filter((p) => p.status === "Disapproved").length };
  return <div className="content-wrap dashboard-page"><div className="dashboard-welcome"><div><span className="eyebrow"><ShieldCheck size={14} /> SUPERADMIN WORKSPACE</span><h1>{philippineNow ? philippineGreeting(philippineNow) : "Welcome"},<br /><span>let’s keep things</span> <i>moving.</i></h1><p>Manage registrations, shape the program calendar, and keep resources organized.</p></div><div className="dashboard-date"><span>{philippineNow ? new Intl.DateTimeFormat("en-PH", { weekday: "long", timeZone: "Asia/Manila" }).format(philippineNow).toUpperCase() : "PHILIPPINE TIME"}</span><strong>{philippineNow ? new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", timeZone: "Asia/Manila" }).format(philippineNow) : "—"}</strong><small>CARAGA · REGION XIII</small></div></div>
    <div className="admin-stats"><div className="admin-stat admin-stat--highlight"><span className="stat-label">NEEDS REVIEW</span><strong>{String(counts.Pending).padStart(2, "0")}</strong><span className="stat-foot"><span className="online-dot" />Pending registrations</span></div><div className="admin-stat"><span className="stat-label">APPROVED USERS</span><strong>{String(counts.Approved).padStart(2, "0")}</strong><span className="stat-foot">Cleared for sign-in</span></div><div className="admin-stat"><span className="stat-label">NOT APPROVED</span><strong>{String(counts.Disapproved).padStart(2, "0")}</strong><span className="stat-foot">Can be reviewed again</span></div><div className="admin-stat admin-quick-actions"><span className="stat-label">QUICK ACTIONS</span><button onClick={onAddProgram}><Plus size={15} /> Create a program <ArrowUpRight size={14} /></button><button onClick={onAddMaterial}><Plus size={15} /> Add a material <ArrowUpRight size={14} /></button></div></div>
    <section className="approval-panel"><div className="panel-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h2>User approval <span>& directory</span></h2><p>Verified accounts appear here as Pending. Approve an account to unlock member access.</p></div><div className="approval-filter">{["Pending", "Approved", "Disapproved", "All"].map((status) => <button key={status} className={filter === status ? "filter-chip filter-chip--active" : "filter-chip"} onClick={() => setFilter(status)}>{status}{status === "Pending" && <span>{counts.Pending}</span>}</button>)}</div></div>
      <div className="approval-table-wrap"><table className="approval-table"><thead><tr><th>NAME / EMAIL</th><th>DESIGNATION</th><th>OFFICE</th><th>CONTACT NO.</th><th>ROLE</th><th>STATUS</th></tr></thead><tbody>
        {filtered.map((profile) => <tr key={profile.uid}><td><div className="user-cell"><span className="user-avatar">{nameInitials(profile)}</span><span><strong>{fullName(profile)}</strong><small>{profile.email}</small></span></div></td><td><strong className="table-primary">{profile.designation || profile.position}</strong><small className="table-muted">{profile.position}</small></td><td>{profile.office}</td><td>{profile.contactNo}</td><td><select aria-label={`Role for ${fullName(profile)}`} className={`role-select role-select--${profileRole(profile)}`} value={profileRole(profile)} disabled={profile.email.toLowerCase() === SUPERADMIN_EMAIL} onChange={(event) => onChangeRole(profile, event.target.value as UserRole)}><option value="superadmin">superadmin</option><option value="regular">regular</option></select></td><td><select aria-label={`Status for ${fullName(profile)}`} className={`status-select status-select--${profile.status.toLowerCase()}`} value={profile.status} onChange={(event) => onChangeStatus(profile, event.target.value as UserProfile["status"])}><option>Pending</option><option>Approved</option><option>Disapproved</option></select></td></tr>)}
        {!filtered.length && <tr><td colSpan={6} className="empty-table"><UsersRound size={20} /><strong>{loading ? "Loading registrations…" : "No accounts in this view"}</strong><span>{loading ? "Your directory will appear in a moment." : "New registrations will show up here."}</span></td></tr>}
      </tbody></table></div><div className="table-footnote"><span><LockKeyhole size={13} /> Personal details are private to superadmins.</span><span>{filtered.length} {filtered.length === 1 ? "account" : "accounts"}</span></div>
    </section>
  </div>;
}

function ManageDashboard({ programs, materials, mechanics, onAddProgram, onEditProgram, onDeleteProgram, onAddMaterial, onEditMaterial, onDeleteMaterial, onAddMechanics, onEditMechanics, onDeleteMechanics, onBack }: {
  programs: Program[]; materials: Material[]; mechanics: ContestMechanics[];
  onAddProgram: () => void; onEditProgram: (program: Program) => void; onDeleteProgram: (program: Program) => void;
  onAddMaterial: () => void; onEditMaterial: (material: Material) => void; onDeleteMaterial: (material: Material) => void;
  onAddMechanics: () => void; onEditMechanics: (mechanics: ContestMechanics) => void; onDeleteMechanics: (mechanics: ContestMechanics) => void; onBack: () => void;
}) {
  const actions = (label: string, onEdit: () => void, onDelete: () => void) => <div className="manage-row-actions"><button className="manage-action-button" aria-label={`Edit ${label}`} title="Edit" onClick={onEdit}><Pencil size={15} /></button><button className="manage-action-button manage-action-button--delete" aria-label={`Delete ${label}`} title="Delete" onClick={onDelete}><Trash2 size={15} /></button></div>;
  return <div className="content-wrap dashboard-page"><button className="back-link" onClick={onBack}><ChevronLeft size={16} /> Back to approvals</button><div className="section-heading"><div><span className="eyebrow">SUPERADMIN CONTENT MANAGEMENT</span><h2>Manage <span>content</span></h2><p>Create, review, edit, and remove programs, contests, and materials.</p></div></div><div className="manage-grid">
    <div className="manage-card"><div className="manage-card-heading"><div><CalendarDays size={18} /><h3>Programs</h3></div><button className="button button--soft" onClick={onAddProgram}><Plus size={15} /> Add</button></div>{programs.map((program) => <div className="manage-row" key={program.id}><div><strong>{program.eventTitle}</strong><small>{dateRange(program.dateFrom, program.dateTo)} · {program.venue}</small>{program.theme && <small>{program.theme}</small>}</div><span>{program.flow.length} sessions</span>{actions(program.eventTitle, () => onEditProgram(program), () => onDeleteProgram(program))}</div>)}{!programs.length && <p className="manage-empty">No programs have been published yet.</p>}</div>
    <div className="manage-card"><div className="manage-card-heading"><div><FileText size={18} /><h3>Contest mechanics</h3></div><button className="button button--soft" onClick={onAddMechanics}><Plus size={15} /> Add</button></div>{mechanics.map((item) => <div className="manage-row" key={item.id}><div><strong>{item.contest}</strong><small>{item.eventTitle} · {item.criteria?.length ?? 0} criteria</small></div><span>{contestWeightTotal(item.criteria)}%</span>{actions(item.contest, () => onEditMechanics(item), () => onDeleteMechanics(item))}</div>)}{!mechanics.length && <p className="manage-empty">No contest mechanics have been added yet.</p>}</div>
    <div className="manage-card"><div className="manage-card-heading"><div><FileCheck2 size={18} /><h3>Materials</h3></div><button className="button button--soft" onClick={onAddMaterial}><Plus size={15} /> Add</button></div>{materials.map((material) => <div className="manage-row" key={material.id}><div><strong>{material.name}</strong><small>{material.programTitle} · {material.category}</small></div><a href={material.url} target="_blank" rel="noreferrer" aria-label={`Open ${material.name}`}><ArrowUpRight size={15} /></a>{actions(material.name, () => onEditMaterial(material), () => onDeleteMaterial(material))}</div>)}{!materials.length && <p className="manage-empty">The resource library is ready for its first upload.</p>}</div>
  </div></div>;
}

function contestWeightTotal(criteria: ContestMechanics["criteria"] = []) {
  return criteria.reduce((total, item) => total + (Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0), 0);
}

function ContestMechanicsPage({ mechanics, joins, profiles, contestantsLoading, programs, loading, onAdd, onEdit, onDelete }: {
  mechanics: ContestMechanics[]; joins: ContestJoin[]; profiles: UserProfile[]; contestantsLoading: boolean; programs: Program[]; loading: boolean; onAdd: () => void; onEdit: (mechanics: ContestMechanics) => void; onDelete: (mechanics: ContestMechanics) => void;
}) {
  const [viewingContestants, setViewingContestants] = useState<ContestMechanics | null>(null);
  const profilesByUid = new Map(profiles.map((profile) => [profile.uid, profile]));
  const selectedJoins = viewingContestants ? joins.filter((join) => join.contestId === viewingContestants.id) : [];
  const sortedJoins = selectedJoins.slice().sort((a, b) => {
    const nameA = fullName(profilesByUid.get(a.uid) ?? {}).toLowerCase();
    const nameB = fullName(profilesByUid.get(b.uid) ?? {}).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  return <>
    <div className="content-wrap dashboard-page contest-page">
      <div className="section-heading contest-heading"><div><span className="eyebrow">SUPERADMIN WORKSPACE</span><h2>Contest <span>& mechanics</span></h2><p>Set contest criteria and review the members who joined each contest.</p></div><button className="button button--olive" onClick={onAdd}><Plus size={16} /> Add mechanics</button></div>
      <section className="approval-panel contest-panel"><div className="panel-heading"><div><span className="eyebrow">CONTEST DIRECTORY</span><h2>Published mechanics</h2><p>View each contest's criteria and registered contestants.</p></div><span className="contest-count">{String(mechanics.length).padStart(2, "0")} CONTESTS</span></div>
        <div className="approval-table-wrap"><table className="approval-table contest-table"><thead><tr><th>PROGRAM</th><th>CONTEST</th><th>CRITERIA</th><th>CONTESTANTS</th><th>ACTIONS</th></tr></thead><tbody>
          {mechanics.map((item) => {
            const contestantCount = joins.filter((join) => join.contestId === item.id).length;
            return <tr key={item.id}><td><strong className="table-primary">{item.eventTitle}</strong><small className="table-muted">{dateRange(item.dateFrom, item.dateTo)} · {item.venue}</small></td><td><strong className="table-primary">{item.contest}</strong></td><td><div className="contest-criteria-list">{(item.criteria || []).map((criterion, index) => <span key={`${criterion.criteria}-${index}`}>{criterion.criteria}</span>)}</div></td><td><div className="contestant-view-cell"><span>{contestantCount} joined</span><button className="contest-view" aria-label={`View contestants for ${item.contest}`} onClick={() => setViewingContestants(item)}><Eye size={15} />View</button></div></td><td><div className="manage-row-actions"><button className="manage-action-button" aria-label={`Edit ${item.contest}`} title="Edit" onClick={() => onEdit(item)}><Pencil size={15} /></button><button className="manage-action-button manage-action-button--delete" aria-label={`Delete ${item.contest}`} title="Delete" onClick={() => onDelete(item)}><Trash2 size={15} /></button></div></td></tr>;
          })}
          {!mechanics.length && <tr><td colSpan={5} className="empty-table"><FileCheck2 size={20} /><strong>{loading ? "Loading contest mechanics…" : "No contest mechanics yet"}</strong><span>{loading ? "Saved contests will appear here." : programs.length ? "Add the criteria and scoring details for a program contest." : "Publish a program before adding contest mechanics."}</span></td></tr>}
        </tbody></table></div><div className="table-footnote"><span><ShieldCheck size={13} /> Only verified superadmins can view contestant details and edit contest mechanics.</span><span>{mechanics.length} {mechanics.length === 1 ? "contest" : "contests"}</span></div>
      </section>
    </div>
    {viewingContestants && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingContestants(null); }}><section className="form-modal contestants-modal" role="dialog" aria-modal="true" aria-labelledby="contestants-modal-title"><div className="form-modal-head"><div><span className="eyebrow">CONTESTANTS</span><h2 id="contestants-modal-title">{viewingContestants.contest}<span>.</span></h2><p>{viewingContestants.eventTitle} · {dateRange(viewingContestants.dateFrom, viewingContestants.dateTo)}</p></div><button className="modal-close modal-close--inline" onClick={() => setViewingContestants(null)} aria-label="Close contestants list"><X size={19} /></button></div><div className="contestants-table-wrap"><table className="approval-table contestants-table"><thead><tr><th>NAME</th><th>DESIGNATION</th><th>OFFICE</th><th>CONTACT NO.</th></tr></thead><tbody>{contestantsLoading ? <tr><td colSpan={4} className="empty-table">Loading contestants…</td></tr> : sortedJoins.length ? sortedJoins.map((join) => {
      const profile = profilesByUid.get(join.uid);
      return <tr key={join.id}><td><strong className="table-primary">{profile ? fullName(profile) || "Member" : "Member profile unavailable"}</strong></td><td>{profile?.designation || "—"}</td><td>{profile?.office || "—"}</td><td>{profile?.contactNo || "—"}</td></tr>;
    }) : <tr><td colSpan={4} className="empty-table"><UsersRound size={20} /><strong>No contestants yet</strong><span>Members who join this contest will appear here.</span></td></tr>}</tbody></table></div><div className="form-modal-actions"><button className="button button--soft" onClick={() => setViewingContestants(null)}>Close</button></div></section></div>}
  </>;
}

function ContestsPage({ contests, joinedContestIds, joiningContestId, loading, onJoin }: {
  contests: ContestMechanics[]; joinedContestIds: string[]; joiningContestId: string; loading: boolean; onJoin: (contest: ContestMechanics) => void;
}) {
  const [selectedContestId, setSelectedContestId] = useState("");
  const selectedContest = contests.find((contest) => contest.id === selectedContestId);
  return <div className="content-wrap dashboard-page contest-page">
    <div className="section-heading contest-heading"><div><span className="eyebrow">LEARN · SHARE · GROW</span><h2>Contests <span>& opportunities</span></h2><p>Explore program contests, review their mechanics, and join when you’re ready.</p></div><span className="contest-count">{String(contests.length).padStart(2, "0")} CONTESTS</span></div>
    <section className="approval-panel contest-panel"><div className="panel-heading"><div><span className="eyebrow">OPEN CONTESTS</span><h2>Program contests</h2><p>Your participation is saved to your approved member account.</p></div></div>
      <div className="approval-table-wrap"><table className="approval-table contest-table"><thead><tr><th>PROGRAM / EVENT</th><th>CONTEST</th><th>JOIN</th><th>MECHANICS</th></tr></thead><tbody>
        {contests.map((contest) => {
          const joined = joinedContestIds.includes(contest.id);
          return <tr key={contest.id}><td><strong className="table-primary">{contest.eventTitle}</strong><small className="table-muted">{dateRange(contest.dateFrom, contest.dateTo)} · {contest.venue}</small></td><td><strong className="table-primary">{contest.contest}</strong></td><td><button className={`contest-join${joined ? " contest-join--joined" : ""}`} disabled={joined || joiningContestId === contest.id} onClick={() => onJoin(contest)}>{joined ? <><Check size={14} /> Joined</> : joiningContestId === contest.id ? "Joining…" : "Join"}</button></td><td><button className="contest-view" aria-expanded={selectedContestId === contest.id} onClick={() => setSelectedContestId((current) => current === contest.id ? "" : contest.id)}>{selectedContestId === contest.id ? "Hide mechanics" : "View mechanics"}<ArrowUpRight size={14} /></button></td></tr>;
        })}
        {!contests.length && <tr><td colSpan={4} className="empty-table"><CalendarDays size={20} /><strong>{loading ? "Loading contests…" : "No contests have been published yet"}</strong><span>{loading ? "Program contests will appear here." : "Check back when a program contest is announced."}</span></td></tr>}
      </tbody></table></div>
    </section>
    {selectedContest && <section className="approval-panel contest-mechanics-detail" aria-live="polite"><div className="panel-heading"><div><span className="eyebrow">{selectedContest.eventTitle}</span><h2>{selectedContest.contest} <span>mechanics</span></h2><p>{dateRange(selectedContest.dateFrom, selectedContest.dateTo)} · {selectedContest.venue}</p></div></div><div className="approval-table-wrap"><table className="approval-table contest-detail-table"><thead><tr><th>CRITERIA</th><th>DESCRIPTION</th><th>WEIGHT</th></tr></thead><tbody>{(selectedContest.criteria || []).map((criterion, index) => <tr key={`${criterion.criteria}-${index}`}><td><strong className="table-primary">{criterion.criteria}</strong></td><td className="contest-description">{criterion.description}</td><td><strong className="contest-weight">{Number(criterion.weight)}%</strong></td></tr>)}<tr className="contest-total-row"><td colSpan={2}><strong>Total</strong></td><td><strong className="contest-weight">{contestWeightTotal(selectedContest.criteria)}%</strong></td></tr></tbody></table></div></section>}
  </div>;
}

function ContestMechanicsModal({ programs, initialMechanics, onClose, onCreate }: { programs: Program[]; initialMechanics: ContestMechanics | null; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void }) {
  const [criteriaRows, setCriteriaRows] = useState(() => initialMechanics?.criteria?.length ? initialMechanics.criteria.map((item) => ({ ...item, weight: String(item.weight) })) : [{ criteria: "", description: "", weight: "" }]);
  const updateCriteria = (index: number, field: "criteria" | "description" | "weight", value: string) => {
    setCriteriaRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="form-modal contest-editor" role="dialog" aria-modal="true" aria-label={initialMechanics ? "Edit contest mechanics" : "Add contest mechanics"}><div className="form-modal-head"><div><span className="eyebrow">CONTEST SETTINGS</span><h2>{initialMechanics ? "Edit contest mechanics" : "Add contest mechanics"}<span>.</span></h2><p>Set up the contest rubric. Add as many criteria rows as needed.</p></div><button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form onSubmit={onCreate}>
    <Field label="Program"><select name="programId" required defaultValue={initialMechanics?.programId ?? ""}><option value="" disabled>Select a published program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle} · {dateRange(program.dateFrom, program.dateTo)} · {program.venue}</option>)}</select></Field>
    <Field label="Contest"><input name="contest" defaultValue={initialMechanics?.contest ?? ""} placeholder="e.g. Agri-innovation showcase" required /></Field>
    <input type="hidden" name="criteriaRows" value={JSON.stringify(criteriaRows)} readOnly />
    <div className="criteria-editor-heading"><span>CRITERIA & SCORING</span><button type="button" className="text-action" onClick={() => setCriteriaRows((current) => [...current, { criteria: "", description: "", weight: "" }])}><Plus size={15} /> Add Another Criteria</button></div>
    <div className="criteria-editor-list">{criteriaRows.map((row, index) => <div className="criteria-editor-row" key={index}><span className="criteria-editor-number">{String(index + 1).padStart(2, "0")}</span><label><span>Criteria</span><input aria-label={`Criteria ${index + 1}`} value={row.criteria} onChange={(event) => updateCriteria(index, "criteria", event.target.value)} placeholder="e.g. Innovation and relevance" required /></label><label><span>Description</span><textarea aria-label={`Description for criteria ${index + 1}`} value={row.description} onChange={(event) => updateCriteria(index, "description", event.target.value)} placeholder="Describe what judges should look for" rows={2} required /></label><label><span>Weight (%)</span><input aria-label={`Weight for criteria ${index + 1}`} type="number" min="0" step="0.01" value={row.weight} onChange={(event) => updateCriteria(index, "weight", event.target.value)} placeholder="e.g. 25" required /></label><button type="button" className="criteria-remove" disabled={criteriaRows.length === 1} aria-label={`Remove criteria ${index + 1}`} onClick={() => setCriteriaRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button></div>)}</div>
    {programs.length === 0 && <p className="form-hint">Publish a program before adding its contest mechanics.</p>}
    <div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" disabled={programs.length === 0} className="button button--olive">{initialMechanics ? "Save changes" : "Save mechanics"} <ArrowRight size={16} /></button></div>
  </form></div></div>;
}

function MaterialsPage({ materials, programs, isAdmin, onAdd, onDownload, loading }: { materials: Material[]; programs: Program[]; isAdmin: boolean; onAdd: () => void; onDownload: (material: Material) => void; loading: boolean }) {
  const [category, setCategory] = useState("All resources");
  const [program, setProgram] = useState("All programs");
  const [queryText, setQueryText] = useState("");
  const displayed = materials.filter((material) => (category === "All resources" || material.category === category) && (program === "All programs" || material.programId === program) && (!queryText || `${material.name} ${material.programTitle}`.toLowerCase().includes(queryText.toLowerCase())));
  const colorByCategory: Record<string, string> = { Guidelines: "resource-green", Presentation: "resource-yellow", References: "resource-blue", Worksheet: "resource-orange" };
  return <div className="content-wrap materials-page"><section className="materials-hero"><div><span className="eyebrow"><FileCheck2 size={14} /> THE RESOURCE SHELF</span><h1>Useful things,<br /><span>within</span> <i>reach.</i></h1><p>Presentations, guides, worksheets, and references shared by the Caraga extension community.</p></div><div className="materials-hero-art"><span className="paper paper--one"><FileText size={22} /><b>FIELD<br />GUIDE</b><i /></span><span className="paper paper--two"><span>01</span><strong>Learn<br />by doing.</strong><i /></span><span className="paper paper--three"><Sparkles size={16} /><small>SHARED<br />KNOWLEDGE</small></span></div></section>
    <div className="resource-toolbar"><label className="search-box"><Search size={16} /><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Search materials" aria-label="Search materials" /></label><label className="filter-select"><Filter size={14} /><select value={program} onChange={(event) => setProgram(event.target.value)} aria-label="Filter by program"><option>All programs</option>{programs.map((item) => <option key={item.id} value={item.id}>{item.eventTitle}</option>)}</select><ChevronDown size={13} /></label>{isAdmin && <button className="button button--olive" onClick={onAdd}><Upload size={16} /> Add material</button>}</div>
    <div className="resource-categories"><button className={category === "All resources" ? "category-tab category-tab--active" : "category-tab"} onClick={() => setCategory("All resources")}>All resources <span>{materials.length}</span></button>{categories.map((item) => <button key={item} className={category === item ? "category-tab category-tab--active" : "category-tab"} onClick={() => setCategory(item)}>{item}<span>{materials.filter((m) => m.category === item).length}</span></button>)}</div>
    <div className="resource-grid">{displayed.map((material, index) => <article className={`resource-card ${colorByCategory[material.category] || ""}`} key={material.id} style={{ animationDelay: `${index * 50}ms` }}><div className="resource-card-top"><span className="resource-icon"><FileText size={20} /></span><span className="resource-category">{material.category}</span></div><h3>{material.name}</h3><p>{material.programTitle}</p><div className="resource-card-foot"><span><span className="online-dot" />Available to all members</span><button type="button" onClick={() => onDownload(material)} aria-label={`Download ${material.name}`} title={`Download ${material.name}`}><Download size={17} /></button></div></article>)}
      {!displayed.length && <div className="resource-empty"><div><FileCheck2 size={23} /></div><span className="eyebrow">A LITTLE ROOM TO GROW</span><h2>{loading ? "Gathering your materials…" : "The shelf is ready."}</h2><p>{loading ? "Shared resources will appear here." : "When a program resource is shared, you’ll find it here organized by type."}</p>{isAdmin && <button className="button button--olive" onClick={onAdd}><Plus size={16} /> Add the first material</button>}</div>}
    </div><div className="materials-footnote"><Leaf size={16} /><span>Know something useful? Share it with the team and help good ideas travel.</span></div>
  </div>;
}

function MaterialsTeaser({ materials, onOpen, onDownload }: { materials: Material[]; onOpen: () => void; onDownload: (material: Material) => void }) {
  return <section className="content-wrap materials-teaser"><div className="teaser-copy"><span className="eyebrow">TAKE IT WITH YOU</span><h2>Good ideas are<br /><i>meant to be shared.</i></h2><p>Find guides, presentations, and worksheets shared by the community.</p><button className="text-action" onClick={onOpen}>Visit the resource shelf <ArrowRight size={16} /></button></div><div className="teaser-shelf"><div className="shelf-top"><span>THE SHARED SHELF</span><span>{String(materials.length).padStart(2, "0")} ITEMS <ArrowUpRight size={13} /></span></div><div className="shelf-items">{materials.length ? materials.slice(0, 3).map((item, index) => <div className={`shelf-item shelf-item--${index}`} key={item.id}><span className="shelf-file-icon"><FileText size={16} /></span><span><strong>{item.name}</strong><small>{item.category}</small></span><button className="shelf-open" type="button" onClick={() => onDownload(item)} aria-label={`Download ${item.name}`} title={`Download ${item.name}`}><Download size={15} /></button></div>) : <div className="shelf-empty"><FileText size={18} /><span>No materials have been added yet.</span></div>}</div><div className="shelf-bottom"><span><span className="online-dot" /> Shared resources</span><span>CARAGA REGION XIII</span></div></div></section>;
}

function ProgramModal({ initialProgram, onClose, onCreate }: { initialProgram: Program | null; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void }) {
  const [sessions, setSessions] = useState<ProgramSession[]>(() => initialProgram?.flow?.length ? initialProgram.flow.map((item) => ({ ...item, ...sessionTimeRange(item), allParticipants: Boolean(item.allParticipants), responsibleNotApplicable: Boolean(item.responsibleNotApplicable), responsible: responsiblePeople(item.responsible).length ? responsiblePeople(item.responsible) : [emptyResponsiblePerson()] })) : [{ date: "", startTime: "", endTime: "", session: "", track: "", allParticipants: false, responsibleNotApplicable: false, responsible: [emptyResponsiblePerson()] }]);
  const updateSession = (index: number, updates: Partial<ProgramSession>) => setSessions((current) => current.map((session, i) => i === index ? { ...session, ...updates } : session));
  const updateResponsible = (sessionIndex: number, personIndex: number, field: keyof ResponsiblePerson, value: string) => setSessions((current) => current.map((session, i) => {
    if (i !== sessionIndex) return session;
    const people = responsiblePeople(session.responsible);
    return { ...session, responsible: people.map((person, j) => j === personIndex ? { ...person, [field]: value } : person) };
  }));
  const addSession = () => setSessions((current) => [...current, { date: current[0]?.date || "", startTime: "", endTime: "", session: "", track: "", allParticipants: false, responsibleNotApplicable: false, responsible: [emptyResponsiblePerson()] }]);
  const addResponsible = (sessionIndex: number) => setSessions((current) => current.map((session, i) => i === sessionIndex ? { ...session, responsible: [...responsiblePeople(session.responsible), emptyResponsiblePerson()] } : session));
  const removeResponsible = (sessionIndex: number, personIndex: number) => setSessions((current) => current.map((session, i) => i === sessionIndex ? { ...session, responsible: responsiblePeople(session.responsible).filter((_, j) => j !== personIndex) } : session));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="form-modal program-editor" role="dialog" aria-modal="true" aria-label={initialProgram ? "Edit program" : "Create a program"}><div className="form-modal-head"><div><span className="eyebrow">PROGRAM EDITOR</span><h2>{initialProgram ? "Update program" : "Build a program"}<span>.</span></h2><p>Set the event details and add the first sessions to the daily flow.</p></div><button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form autoComplete="off" onSubmit={(event) => { event.preventDefault(); const target = event.currentTarget; const hidden = target.querySelector<HTMLInputElement>("[name=flowJson]"); if (hidden) hidden.value = JSON.stringify(sessions); onCreate(event); }}><input type="hidden" name="flowJson" value={JSON.stringify(sessions)} readOnly /><div className="editor-grid"><Field label="Event title"><input autoComplete="off" name="eventTitle" defaultValue={initialProgram?.eventTitle ?? ""} placeholder="e.g. Regional learning exchange" required /></Field><Field label="Theme"><input autoComplete="off" name="theme" defaultValue={initialProgram?.theme ?? ""} placeholder="e.g. Sustainable agriculture, thriving communities" required /></Field><Field label="Venue"><input autoComplete="off" name="venue" defaultValue={initialProgram?.venue ?? ""} placeholder="City, venue, or online" required /></Field><Field label="Date from"><input autoComplete="off" type="date" name="dateFrom" defaultValue={initialProgram?.dateFrom ?? ""} onChange={(event) => { if (!sessions[0]?.date) updateSession(0, { date: event.target.value }); }} required /></Field><Field label="Date to"><input autoComplete="off" type="date" name="dateTo" defaultValue={initialProgram?.dateTo ?? ""} required /></Field><Field label="Short description"><input autoComplete="off" name="description" defaultValue={initialProgram?.description ?? ""} placeholder="A short note for participants" /></Field></div><div className="editor-session-head"><div><span className="eyebrow">DAILY PROGRAM FLOW</span><p>Each session has its own date, start and end time, and track.</p></div><button type="button" className="text-action" onClick={addSession}><Plus size={15} /> Add a session</button></div><div className="session-edit-list">{sessions.map((item, index) => <section className="session-edit-row" key={index} aria-label={`Session ${index + 1}`}><div className="session-edit-main"><span className="session-edit-num">{String(index + 1).padStart(2, "0")}</span><label className="session-edit-field session-edit-field--date"><span>Session date</span><input autoComplete="off" type="date" value={item.date} onChange={(event) => updateSession(index, { date: event.target.value })} required /></label><label className="session-edit-field session-edit-field--start"><span>Start time</span><input autoComplete="off" lang="en-US" type="time" aria-label="Start time (HH:MM AM/PM)" value={sessionTimeRange(item).startTime} onChange={(event) => updateSession(index, { startTime: event.target.value })} required /></label><label className="session-edit-field session-edit-field--end"><span>End time</span><input autoComplete="off" lang="en-US" type="time" aria-label="End time (HH:MM AM/PM)" value={sessionTimeRange(item).endTime} onChange={(event) => updateSession(index, { endTime: event.target.value })} required /></label><label className="session-edit-field session-edit-field--title"><span>Session title</span><input autoComplete="off" placeholder="e.g. Opening ceremony" value={item.session} onChange={(event) => updateSession(index, { session: event.target.value })} required /></label><label className="session-edit-field session-edit-field--track"><span>Track</span><select autoComplete="off" required value={item.track} onChange={(event) => updateSession(index, { track: event.target.value })}><option value="" disabled>Select track</option>{tracks.map((track) => <option key={track}>{track}</option>)}</select></label><button type="button" aria-label="Remove session" className="remove-session" disabled={sessions.length === 1} onClick={() => setSessions((current) => current.filter((_, i) => i !== index))}><X size={15} /></button></div><div className="session-edit-responsibles"><div className="session-edit-responsibles-head"><span>Responsible people</span><button type="button" className="text-action" disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onClick={() => addResponsible(index)}><Plus size={13} /> Add responsible</button></div>{responsiblePeople(item.responsible).map((person, personIndex) => <div className="responsible-edit-row" key={personIndex}><input autoComplete="off" aria-label="Responsible name" placeholder="Responsible" value={person.name} disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onChange={(event) => updateResponsible(index, personIndex, "name", event.target.value)} /><input autoComplete="off" aria-label="Responsible designation" placeholder="Designation" value={person.designation} disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onChange={(event) => updateResponsible(index, personIndex, "designation", event.target.value)} /><input autoComplete="off" aria-label="Responsible office" placeholder="Office" value={person.office} disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onChange={(event) => updateResponsible(index, personIndex, "office", event.target.value)} /><span className="all-participants-slot">{personIndex === 0 ? <span className="responsible-options"><label className="all-participants-toggle"><input type="checkbox" aria-label="All Participants" checked={Boolean(item.allParticipants)} onChange={(event) => updateSession(index, { allParticipants: event.target.checked, responsibleNotApplicable: false })} /><span>All Participants</span></label><label className="all-participants-toggle"><input type="checkbox" aria-label="Responsible Not Applicable" checked={Boolean(item.responsibleNotApplicable)} onChange={(event) => updateSession(index, { responsibleNotApplicable: event.target.checked, allParticipants: false })} /><span>Responsible Not Applicable</span></label></span> : null}</span><button type="button" aria-label={`Remove responsible person ${personIndex + 1}`} className="remove-session" disabled={Boolean(item.allParticipants || item.responsibleNotApplicable) || responsiblePeople(item.responsible).length <= 1} onClick={() => removeResponsible(index, personIndex)}><X size={14} /></button></div>)}</div></section>)}</div><div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" className="button button--olive">{initialProgram ? "Save changes" : "Publish program"} <ArrowRight size={16} /></button></div></form></div></div>;
}

function MaterialModal({ programs, initialMaterial, onClose, onCreate, busy }: { programs: Program[]; initialMaterial: Material | null; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const [selectedFileName, setSelectedFileName] = useState("");
  const [resourceUrl, setResourceUrl] = useState(initialMaterial?.url ?? "");
  const [resourceError, setResourceError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("materialFile");
    if (!(file instanceof File && file.size > 0) && !resourceUrl.trim()) {
      setResourceError("Choose a file or enter a resource URL before adding this material.");
      return;
    }
    setResourceError("");
    onCreate(event);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="form-modal material-editor" role="dialog" aria-modal="true" aria-label={initialMaterial ? "Edit a material" : "Add a material"}><div className="form-modal-head"><div><span className="eyebrow">RESOURCE LIBRARY</span><h2>{initialMaterial ? "Edit a material" : "Add a material"}<span>.</span></h2><p>Link a resource or upload a file for a published program.</p></div><button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form onSubmit={handleSubmit}><Field label="Program"><select name="programId" required defaultValue={initialMaterial?.programId ?? ""}><option value="" disabled>Select a published program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle} · {dateRange(program.dateFrom, program.dateTo)} · {program.venue}</option>)}</select></Field><Field label="Category"><select name="category" defaultValue={initialMaterial?.category ?? "Guidelines"}>{categories.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Material name"><input name="materialName" defaultValue={initialMaterial?.name ?? ""} placeholder="e.g. Participant guide" /></Field><label className="field"><span className="field-label">Upload a file</span><span className="file-picker"><Upload size={18} /><span><strong>{selectedFileName || "Choose a file"}</strong><small>{selectedFileName ? "Selected for upload" : "PDF, presentation, worksheet, or document · up to 16 MB"}</small></span><input type="file" name="materialFile" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" onChange={(event) => { setSelectedFileName(event.target.files?.[0]?.name ?? ""); setResourceError(""); }} /></span></label><div className="or-divider"><span>OR ADD A LINK</span></div><Field label="Resource URL"><input type="url" name="materialUrl" value={resourceUrl} onChange={(event) => { setResourceUrl(event.target.value); setResourceError(""); }} placeholder="https://…" /></Field><p className="form-hint">Add either a resource URL or an uploaded file. You can leave the other option empty.</p>{resourceError && <p className="material-form-error" role="alert">{resourceError}</p>}<p className="upload-note"><LockKeyhole size={13} /> Uploads are available to approved members. Public program materials can be viewed without signing in.</p><div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || programs.length === 0} className="button button--olive">{busy ? "Uploading…" : initialMaterial ? "Save changes" : "Add material"}<ArrowRight size={16} /></button></div>{programs.length === 0 && <p className="form-hint">Publish a program before adding its materials.</p>}</form></div></div>;
}

function DeleteConfirmModal({ target, busy, onClose, onConfirm }: { target: DeleteTarget; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const title = target.kind === "mechanics" ? "contest mechanics" : target.kind;
  const detail = target.kind === "program"
    ? "This also removes its contest mechanics, linked materials, and contest join records."
    : target.kind === "mechanics"
      ? "Associated member join records will also be removed."
      : "This removes the material record from the resource library.";
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title"><span className="delete-modal-icon"><Trash2 size={20} /></span><span className="eyebrow">SUPERADMIN ACTION</span><h2 id="delete-modal-title">Delete {title}?</h2><p><strong>{target.label}</strong> will be permanently deleted. {detail}</p><div className="form-modal-actions"><button type="button" className="button button--soft" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button button--danger" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete"}<Trash2 size={15} /></button></div></div></div>;
}

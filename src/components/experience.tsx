"use client";

import { FormEvent, Fragment, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
  EyeOff, FileCheck2, FileText, Filter, LockKeyhole, LogOut, Mail, MapPin,
  Menu, Pencil, Plus, Printer, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, UsersRound, X,
} from "lucide-react";
import { auth, db, AttendanceConfirmation, ContestJoin, ContestMechanics, Material, MaterialCategory, Program, ProgramKeynoteTopic, ProgramSession, ResponsiblePerson, SpeakerAffiliation, SpeakerKeynoteSession, SpeakerProfileCard, SUPERADMIN_EMAIL, UserProfile, UserRole } from "@/lib/firebase";
import { uploadFiles, uploadthingDownloadEndpoint } from "@/lib/uploadthing";

type Section = "home" | "programs" | "contests" | "contestMechanics" | "speakers" | "materials" | "approval" | "manage" | "confirmedAttendees";
const categories: MaterialCategory[] = ["Guidelines", "Presentation", "References", "Worksheet", "Program Flow", "Communication Letter"];
const resourceCategoryOrder: MaterialCategory[] = ["Presentation", ...categories.filter((category) => category !== "Presentation")];
const suffixes = ["Jr.", "Sr.", "II", "III", "IV", "V", "VI"];
const keynoteSessionOptions = ["Corn Program", "HVCDP", "Livestock Program", "Organic Agriculture Program", "Rice Program", "Plenary Forum", "Legislative Forum", "Plenaries and Legislative Forum"];
type DeleteTarget = { kind: "program" | "material" | "mechanics" | "speaker"; id: string; label: string };

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

function dateOptionsBetween(from: string, to: string) {
  if (!from || !to || to < from) return [];
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const start = new Date(fromYear, fromMonth - 1, fromDay, 12);
  const end = new Date(toYear, toMonth - 1, toDay, 12);
  const dates: string[] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
  }
  return dates;
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

function compareContestSchedule(a: Pick<ContestMechanics, "contest" | "contestDate" | "timeStart">, b: Pick<ContestMechanics, "contest" | "contestDate" | "timeStart">) {
  const dateOrder = (a.contestDate || "9999-12-31").localeCompare(b.contestDate || "9999-12-31");
  if (dateOrder) return dateOrder;
  const timeOrder = (a.timeStart || "99:99").localeCompare(b.timeStart || "99:99");
  return timeOrder || a.contest.localeCompare(b.contest);
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

function timeInMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function responsiblePeople(value: ProgramSession["responsible"]): ResponsiblePerson[] {
  if (Array.isArray(value)) return value.map((person) => ({
    name: String(person?.name ?? ""),
    designation: String(person?.designation ?? ""),
    office: String(person?.office ?? ""),
  }));
  return typeof value === "string" && value.trim() ? [{ name: value.trim(), designation: "", office: "" }] : [];
}

function normalizeProgramSession(item: ProgramSession): ProgramSession {
  const responsible = responsiblePeople(item.responsible);
  return {
    date: item.date,
    ...sessionTimeRange(item),
    session: item.session,
    topics: Array.isArray(item.topics) ? item.topics.map((topic) => String(topic ?? "").trim()).filter(Boolean) : [],
    allParticipants: Boolean(item.allParticipants),
    responsibleNotApplicable: Boolean(item.responsibleNotApplicable),
    responsible: responsible.length ? responsible : [emptyResponsiblePerson()],
  };
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

function LoadingProgressScreen({ startedAt, fadeOut, showPercentage }: { startedAt: number | null; fadeOut: boolean; showPercentage: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!showPercentage || startedAt === null) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= startedAt + 5_000) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [showPercentage, startedAt]);

  const progress = startedAt === null ? 30 : Math.min(100, 30 + Math.floor(Math.max(0, now - startedAt) / 5_000 * 70));

  return (
    <div className={`loading-progress-screen${fadeOut ? " is-fading-out" : ""}`} role="status" aria-label="Loading AEW Congress">
      <div className="loading-progress-content">
        <div className="loading-progress-brand" aria-hidden="true">
          <span className="loading-progress-logo"><img src="/AEW_logo_1.png" alt="" /></span>
          <span className="loading-progress-wording"><strong>AEW <em>CONGRESS</em></strong><small>CARAGA REGION</small></span>
        </div>
        {showPercentage && (
          <div className="loading-progress-value" role="progressbar" aria-label="Loading AEW Congress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}%`} aria-live="polite">
            <span>{progress}</span><small>%</small>
          </div>
        )}
        <div className="loading-progress-track" aria-hidden="true">
          <span style={{ transform: `scaleX(${showPercentage ? progress / 100 : 0.3})` }} />
        </div>
        <p className="loading-progress-caption"><span className="loading-progress-dot" />Preparing the congress experience</p>
      </div>
    </div>
  );
}

export default function Experience() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [contestMechanics, setContestMechanics] = useState<ContestMechanics[]>([]);
  const [contestJoins, setContestJoins] = useState<ContestJoin[]>([]);
  const [contestJoinsLoading, setContestJoinsLoading] = useState(false);
  const [joinedContestIds, setJoinedContestIds] = useState<string[]>([]);
  const [joinedContestStatuses, setJoinedContestStatuses] = useState<Record<string, string>>({});
  const [confirmingJoinId, setConfirmingJoinId] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [speakers, setSpeakers] = useState<SpeakerProfileCard[]>([]);
  const [speakersLoading, setSpeakersLoading] = useState(true);
  const [attendanceConfirmations, setAttendanceConfirmations] = useState<AttendanceConfirmation[]>([]);
  const [attendanceConfirmationsLoading, setAttendanceConfirmationsLoading] = useState(false);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [section, setSection] = useState<Section>("home");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);
  const [search, setSearch] = useState("");
  const [hoveredTimeGroup, setHoveredTimeGroup] = useState<number | null>(null);
  const [expandedSessionPeriods, setExpandedSessionPeriods] = useState<Set<string>>(() => new Set());
  const [attendanceStatus, setAttendanceStatus] = useState<{ id: string; confirmed: boolean; loading: boolean }>({ id: "", confirmed: false, loading: false });
  const [attendanceConfirmOpen, setAttendanceConfirmOpen] = useState(false);
  const [attendanceSubmitting, setAttendanceSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "create" | "reset">("login");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [programModal, setProgramModal] = useState(false);
  const [contestMechanicsModal, setContestMechanicsModal] = useState(false);
  const [materialModal, setMaterialModal] = useState(false);
  const [speakerModal, setSpeakerModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [editingMechanics, setEditingMechanics] = useState<ContestMechanics | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<SpeakerProfileCard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [contestMechanicsLoading, setContestMechanicsLoading] = useState(true);
  const [joiningContestId, setJoiningContestId] = useState("");
  const [contestJoinConfirm, setContestJoinConfirm] = useState<ContestMechanics | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [cloudIssue, setCloudIssue] = useState("");
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [loadingFadeOut, setLoadingFadeOut] = useState(false);
  const [loadingScreenVisible, setLoadingScreenVisible] = useState(true);
  const authActionInProgress = useRef(false);

  const isSuperadmin = Boolean(user && user.emailVerified && (user.email?.toLowerCase() === SUPERADMIN_EMAIL || profileRole(activeProfile ?? {}) === "superadmin"));
  const isAdmin = isSuperadmin || Boolean(user && user.emailVerified && profileRole(activeProfile ?? {}) === "admin");
  const isApprovedMember = Boolean(user && !isAdmin && activeProfile?.status === "Approved" && user.emailVerified);
  const isRegularMember = isApprovedMember && profileRole(activeProfile ?? {}) === "regular";
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
  useEffect(() => {
    if (window.location.hash === "#top") {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);
  const selectedProgram = programs.find((program) => program.id === selectedProgramId) ?? programs[0];
  const attendanceConfirmationId = user && selectedProgram ? `${selectedProgram.id}_${user.uid}` : "";
  const attendanceChecking = isRegularMember && (!attendanceConfirmationId || attendanceStatus.id !== attendanceConfirmationId || attendanceStatus.loading);
  const attendanceConfirmed = isRegularMember && attendanceStatus.id === attendanceConfirmationId && attendanceStatus.confirmed;

  useEffect(() => {
    if (!isRegularMember || !attendanceConfirmationId) {
      setAttendanceStatus({ id: attendanceConfirmationId, confirmed: false, loading: false });
      return;
    }
    setAttendanceStatus({ id: attendanceConfirmationId, confirmed: false, loading: true });
    return onSnapshot(doc(db, "attendanceConfirmations", attendanceConfirmationId), (snapshot) => {
      setAttendanceStatus({ id: attendanceConfirmationId, confirmed: snapshot.exists(), loading: false });
    }, (error) => {
      setAttendanceStatus({ id: attendanceConfirmationId, confirmed: false, loading: false });
      setToast({ kind: "error", text: errorText(error) });
    });
  }, [isRegularMember, attendanceConfirmationId]);

  const days = useMemo(() => {
    if (!selectedProgram) return [];
    const first = new Date(`${selectedProgram.dateFrom}T12:00:00`);
    const last = new Date(`${selectedProgram.dateTo}T12:00:00`);
    const values: string[] = [];
    for (const d = new Date(first); d <= last && values.length < 31; d.setDate(d.getDate() + 1)) values.push(d.toISOString().slice(0, 10));
    return values.length ? values : [selectedProgram.dateFrom];
  }, [selectedProgram]);
  const daySessions = useMemo(() => {
    if (!selectedProgram) return [];
    const selectedDate = days[selectedDay];
    return selectedProgram.flow.filter((item) => item.date === selectedDate);
  }, [days, selectedDay, selectedProgram]);
  const filteredSessions = useMemo(() => {
    return daySessions.filter((item) => {
      const needle = search.trim().toLowerCase();
      const responsibleSearch = item.allParticipants ? "All Participants" : item.responsibleNotApplicable ? "" : responsibleSearchText(item.responsible);
      const matchesSearch = !needle || `${item.session} ${responsibleSearch}`.toLowerCase().includes(needle);
      return matchesSearch;
    }).sort((a, b) => {
      const aTime = sessionTimeRange(a);
      const bTime = sessionTimeRange(b);
      return (aTime.startTime || a.time || "").localeCompare(bTime.startTime || b.time || "")
        || aTime.endTime.localeCompare(bTime.endTime);
    });
  }, [daySessions, search]);

  const scheduleRows = useMemo(() => {
    const rows: { item: ProgramSession; timeRowSpan: number; timeGroup: number; period: string; periodLabel: string }[] = [];
    const timedSessions = daySessions.map((item) => sessionTimeRange(item)).filter((range) => range.startTime && range.endTime);
    const firstStart = timedSessions.length ? Math.min(...timedSessions.map((range) => timeInMinutes(range.startTime))) : Infinity;
    const lastEnd = timedSessions.length ? Math.max(...timedSessions.map((range) => timeInMinutes(range.endTime))) : -Infinity;
    const isWholeDay = firstStart <= 5 * 60 + 30 && lastEnd >= 17 * 60 + 30;
    let timeGroup = 0;
    let previousPeriod = "";
    for (let index = 0; index < filteredSessions.length;) {
      const item = filteredSessions[index];
      const time = sessionTimeRange(item);
      const period = isWholeDay ? "WHOLE DAY SESSION" : sessionPeriodLabel(item);
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
  }, [daySessions, filteredSessions]);

  useEffect(() => {
    const stopPrograms = onSnapshot(query(collection(db, "programs"), orderBy("dateFrom", "asc")), (snapshot) => {
      setPrograms(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Program)));
      setCloudIssue("");
      setLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setLoading(false); });
    const stopAuth = onAuthStateChanged(auth, async (current) => {
      setLoadingStartedAt((startedAt) => startedAt ?? Date.now());
      try {
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
          if (profileRole(profile) === "superadmin" || profileRole(profile) === "admin") {
            if (!current.emailVerified) {
              await signOut(auth);
              setToast({ kind: "info", text: "Verify your email address before using admin tools." });
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
      } finally {
        setAuthReady(true);
      }
    }, () => {
      setLoadingStartedAt((startedAt) => startedAt ?? Date.now());
      setAuthReady(true);
    });
    return () => { stopPrograms(); stopAuth(); };
  }, []);

  useEffect(() => {
    if (!authReady || loading || !loadingScreenVisible || loadingStartedAt === null) return;
    if (!user?.emailVerified) {
      setLoadingScreenVisible(false);
      return;
    }

    const revealAt = loadingStartedAt + 7_000;
    const revealDelay = Math.max(0, revealAt - Date.now());
    let fadeEndTimer: number | undefined;
    const revealTimer = window.setTimeout(() => {
      setLoadingFadeOut(true);
      const fadeDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3_000;
      fadeEndTimer = window.setTimeout(() => setLoadingScreenVisible(false), fadeDuration);
    }, revealDelay);

    return () => {
      window.clearTimeout(revealTimer);
      if (fadeEndTimer !== undefined) window.clearTimeout(fadeEndTimer);
    };
  }, [authReady, loading, loadingScreenVisible, loadingStartedAt, user?.emailVerified]);

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
    const stopSpeakers = onSnapshot(collection(db, "speakers"), (snapshot) => {
      setSpeakers(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as SpeakerProfileCard)).sort((a, b) => a.name.localeCompare(b.name)));
      setSpeakersLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setSpeakersLoading(false); });
    return stopSpeakers;
  }, []);

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
      setJoinedContestStatuses({});
      return;
    }
    const stop = onSnapshot(query(collection(db, "contestJoins"), where("uid", "==", user.uid)), (snapshot) => {
      const joins = snapshot.docs.map((entry) => entry.data() as ContestJoin);
      setJoinedContestIds(joins.map((join) => join.contestId));
      setJoinedContestStatuses(Object.fromEntries(joins.map((join) => [join.contestId, join.status ?? "Joined"])));
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
    if (!isSuperadmin) { setProfiles([]); setProfilesLoading(false); return; }
    setProfilesLoading(true);
    const stopProfiles = onSnapshot(query(collection(db, "userProfiles"), orderBy("createdAt", "desc")), (snapshot) => {
      setProfiles(snapshot.docs.map((entry) => entry.data() as UserProfile));
      setProfilesLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setProfilesLoading(false); });
    return stopProfiles;
  }, [isSuperadmin]);

  useEffect(() => {
    if (!isAdmin || isSuperadmin) return;
    let cancelled = false;
    const profileIds = Array.from(new Set([
      ...contestJoins.map((join) => join.uid),
      ...attendanceConfirmations.map((confirmation) => confirmation.uid),
    ].filter(Boolean)));
    if (!profileIds.length) {
      setProfiles([]);
      setProfilesLoading(false);
      return;
    }
    setProfilesLoading(true);
    Promise.all(profileIds.map((uid) => getDoc(doc(db, "userProfiles", uid))))
      .then((snapshots) => {
        if (!cancelled) setProfiles(snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => snapshot.data() as UserProfile));
      })
      .catch((error) => { if (!cancelled) setCloudIssue(errorText(error)); })
      .finally(() => { if (!cancelled) setProfilesLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, isSuperadmin, contestJoins, attendanceConfirmations]);

  useEffect(() => {
    if (!isAdmin) {
      setAttendanceConfirmations([]);
      setAttendanceConfirmationsLoading(false);
      return;
    }
    setAttendanceConfirmationsLoading(true);
    const stopAttendance = onSnapshot(collection(db, "attendanceConfirmations"), (snapshot) => {
      setAttendanceConfirmations(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as AttendanceConfirmation)));
      setAttendanceConfirmationsLoading(false);
    }, (error) => { setCloudIssue(errorText(error)); setAttendanceConfirmationsLoading(false); });
    return stopAttendance;
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

  async function submitAttendanceConfirmation() {
    if (!user || !selectedProgram || !isRegularMember || attendanceChecking || attendanceConfirmed || attendanceSubmitting) return;
    setAttendanceSubmitting(true);
    try {
      await setDoc(doc(db, "attendanceConfirmations", attendanceConfirmationId), {
        programId: selectedProgram.id,
        uid: user.uid,
        confirmedAt: serverTimestamp(),
      });
      setAttendanceStatus({ id: attendanceConfirmationId, confirmed: true, loading: false });
      setAttendanceConfirmOpen(false);
      setToast({ kind: "success", text: "Your attendance has been confirmed." });
    } catch (error) {
      setAttendanceConfirmOpen(false);
      showError(error);
    } finally {
      setAttendanceSubmitting(false);
    }
  }

  async function downloadMaterial(material: Material) {
    if (!isAdmin && material.enabled === false) return;
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
  function openSpeakerEditor(speaker: SpeakerProfileCard | null = null) { setEditingSpeaker(speaker); setSpeakerModal(true); }

  async function getVerifiedAdmin() {
    const current = auth.currentUser;
    if (!current) throw new Error("Sign in with a verified admin account to make this change.");
    await current.reload();
    const token = await current.getIdTokenResult(true);
    const tokenEmail = String(token.claims.email ?? current.email ?? "").trim().toLowerCase();
    if (token.claims.email_verified !== true) {
      throw new Error("Verify your email address, then sign out and sign in again before making this change.");
    }
    if (tokenEmail !== SUPERADMIN_EMAIL) {
      const profileSnapshot = await getDoc(doc(db, "userProfiles", current.uid));
      const role = profileSnapshot.exists() ? profileRole(profileSnapshot.data() as UserProfile) : "regular";
      if (role !== "superadmin" && role !== "admin") {
        throw new Error("Only a verified admin can make this change.");
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
      if (profileRole(profile) === "superadmin" || profileRole(profile) === "admin") {
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          setToast({ kind: "info", text: "Verify your email address before using admin tools." });
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
    if (!isSuperadmin) { setToast({ kind: "error", text: "Only a superadmin can manage user approval." }); return; }
    try {
      await updateDoc(doc(db, "userProfiles", profile.uid), { status, reviewedAt: serverTimestamp() });
      setToast({ kind: "success", text: `${fullName(profile)} marked ${status.toLowerCase()}.` });
    } catch (error) { showError(error); }
  }

  async function changeRole(profile: UserProfile, role: UserRole) {
    if (!isSuperadmin) { setToast({ kind: "error", text: "Only a superadmin can manage account roles." }); return; }
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
      setToast({ kind: "error", text: "Sign in with a verified admin account to publish programs." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const flow = (JSON.parse(String(form.get("flowJson"))) as ProgramSession[]).map(normalizeProgramSession);
    const enteredKeynoteTopics = (JSON.parse(String(form.get("keynoteTopicsJson"))) as ProgramKeynoteTopic[]).map((item) => ({
      date: String(item.date ?? "").trim(),
      session: String(item.session ?? "").trim(),
      topic: String(item.topic ?? "").trim(),
    }));
    const partialKeynoteTopic = enteredKeynoteTopics.some((item) => {
      const hasAnyValue = Boolean(item.date || item.session || item.topic);
      return hasAnyValue && (!item.date || !item.session || !item.topic);
    });
    if (partialKeynoteTopic) {
      setToast({ kind: "error", text: "Complete the date, keynote session, and topic for each keynote row." });
      return;
    }
    const payload = {
      eventTitle: String(form.get("eventTitle")).trim(),
      theme: String(form.get("theme") ?? "").trim(),
      dateFrom: String(form.get("dateFrom")),
      dateTo: String(form.get("dateTo")),
      venue: String(form.get("venue")).trim(),
      description: String(form.get("description")).trim(),
      keynoteTopics: enteredKeynoteTopics.filter((item) => item.date && item.session && item.topic),
      flow,
      createdAt: serverTimestamp(),
    };
    if (payload.dateTo < payload.dateFrom) { setToast({ kind: "error", text: "The end date must be on or after the start date." }); return; }
    if (payload.keynoteTopics.some((item) => item.date < payload.dateFrom || item.date > payload.dateTo || !keynoteSessionOptions.includes(item.session))) {
      setToast({ kind: "error", text: "Choose a keynote date within the event range and a listed keynote session." });
      return;
    }
    try {
      const adminUser = await getVerifiedAdmin();
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
        setToast({ kind: "error", text: `Firestore rejected this program write for ${actualEmail} (verified email: ${verified ? "yes" : "no"}). Check that this account has admin access.` });
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
    try { adminUser = await getVerifiedAdmin(); }
    catch (error) { showError(error); return; }
    const targetProgram = programs.find((program) => program.id === String(form.get("programId")));
    if (!targetProgram) { setToast({ kind: "error", text: "Choose a published program for this material." }); return; }
    const file = form.get("materialFile");
    const externalUrl = String(form.get("materialUrl")).trim();
    const category = String(form.get("category")) as MaterialCategory;
    const topic = category === "Presentation" ? String(form.get("topic") ?? "").trim() : "";
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
        topic,
        name: name || url.split("/").pop() || "Program resource",
        url,
        enabled: editingMaterial ? editingMaterial.enabled !== false : false,
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

  async function toggleMaterialVisibility(material: Material) {
    if (!user || !isAdmin) return;
    const enabled = material.enabled === false;
    try {
      await getVerifiedAdmin();
      await updateDoc(doc(db, "materials", material.id), { enabled, updatedAt: serverTimestamp() });
      setToast({ kind: "success", text: enabled ? "Material is now visible to regular users." : "Material is hidden from regular users." });
    } catch (error) { showError(error); }
  }

  async function createSpeaker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !isAdmin) { setToast({ kind: "error", text: "Only verified admins can manage speaker profiles." }); return; }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let adminUser: User;
    try { adminUser = await getVerifiedAdmin(); }
    catch (error) { showError(error); return; }

    const program = programs.find((item) => item.id === String(form.get("programId")));
    if (!program) { setToast({ kind: "error", text: "Choose a saved program for this speaker." }); return; }
    const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
    const postNominal = String(form.get("postNominal") ?? "").trim();
    const designation = String(form.get("designation") ?? "").trim();
    const office = String(form.get("office") ?? "").trim();
    let affiliations: SpeakerAffiliation[] = [];
    let keynoteSessions: SpeakerKeynoteSession[] = [];
    let topics: string[] = [];
    try {
      const enteredAffiliations = (JSON.parse(String(form.get("affiliationsJson"))) as SpeakerAffiliation[]).map((item) => ({
        position: String(item.position ?? "").trim(),
        organization: String(item.organization ?? "").trim(),
      }));
      const enteredTopics = (JSON.parse(String(form.get("topicsJson"))) as string[]).map((topic) => String(topic ?? "").trim());
      const enteredKeynoteSessions = (JSON.parse(String(form.get("keynoteSessionsJson"))) as SpeakerKeynoteSession[]).map((item) => ({
        date: String(item.date ?? "").trim(),
        session: String(item.session ?? "").trim(),
      }));
      if (enteredAffiliations.some((item) => Boolean(item.position) !== Boolean(item.organization))) {
        setToast({ kind: "error", text: "Complete each position with its organization." });
        return;
      }
      if (enteredKeynoteSessions.some((item) => Boolean(item.date) !== Boolean(item.session))) {
        setToast({ kind: "error", text: "Choose both a date and keynote session for each entry." });
        return;
      }
      affiliations = enteredAffiliations.filter((item) => item.position && item.organization);
      keynoteSessions = enteredKeynoteSessions.filter((item) => item.date && item.session);
      topics = enteredTopics.filter(Boolean);
    } catch { /* Validation below reports incomplete entries. */ }
    if (!name || !designation || !office) {
      setToast({ kind: "error", text: "Complete the speaker name, designation, and office." });
      return;
    }

    const imageFile = form.get("speakerImage");
    let imageUrl = editingSpeaker?.imageUrl ?? "";
    let imageKey = editingSpeaker?.imageKey ?? "";
    if (imageFile instanceof File && imageFile.size > 0) {
      if (!imageFile.type.startsWith("image/")) { setToast({ kind: "error", text: "Choose an image file for the speaker profile." }); return; }
      if (imageFile.size > 8 * 1024 * 1024) { setToast({ kind: "error", text: "Speaker images must be 8 MB or smaller." }); return; }
      setUploadBusy(true);
      try {
        const result = await uploadFiles("speakerImageUploader", {
          files: [imageFile],
          headers: async () => ({ Authorization: `Bearer ${await adminUser.getIdToken()}` }),
        });
        imageUrl = result[0]?.ufsUrl ?? "";
        imageKey = result[0]?.key ?? "";
      } catch (error) { setUploadBusy(false); showError(error); return; }
      setUploadBusy(false);
    }
    if (!imageUrl) { setToast({ kind: "error", text: "Upload a profile image before saving this speaker." }); return; }

    try {
      const payload = { programId: program.id, imageUrl, imageKey, name, postNominal, designation, office, affiliations, keynoteSessions, topics, updatedAt: serverTimestamp() };
      if (editingSpeaker) {
        await updateDoc(doc(db, "speakers", editingSpeaker.id), payload);
      } else {
        await addDoc(collection(db, "speakers"), { ...payload, createdAt: serverTimestamp(), createdBy: adminUser.uid });
      }
      formElement.reset();
      setSpeakerModal(false);
      setEditingSpeaker(null);
      setToast({ kind: "success", text: editingSpeaker ? "Speaker profile updated." : "Speaker profile published." });
    } catch (error) { showError(error); }
  }

  async function createContestMechanics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !isAdmin) {
      setContestMechanicsModal(false);
      setToast({ kind: "error", text: "Sign in with a verified admin account to add contest mechanics." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const program = programs.find((item) => item.id === String(form.get("programId")));
    if (!program) { setToast({ kind: "error", text: "Choose a published program for these mechanics." }); return; }
    const contest = String(form.get("contest")).trim().replace(/\s+/g, " ");
    const contestDate = String(form.get("contestDate") ?? "").trim();
    const timeStart = String(form.get("timeStart") ?? "").trim();
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
    if (!contestDate || !timeStart) {
      setToast({ kind: "error", text: "Choose a contest date and start time." });
      return;
    }
    if (!contest || !criteria.length || criteria.some((row) => !row.criteria || !row.description || !Number.isFinite(row.weight) || row.weight < 0)) {
      setToast({ kind: "error", text: "Complete every criteria row and enter a non-negative weight for each." });
      return;
    }
    const contestId = `${program.id}_${encodeURIComponent(contest.toLowerCase())}`;
    try {
      const adminUser = await getVerifiedAdmin();
      if (editingMechanics) {
        const joins = await getDocs(query(collection(db, "contestJoins"), where("contestId", "==", editingMechanics.id)));
        const updates = [
          { collectionName: "contestMechanics", id: editingMechanics.id, data: { programId: program.id, eventTitle: program.eventTitle, dateFrom: program.dateFrom, dateTo: program.dateTo, venue: program.venue, contest, contestDate, timeStart, criteria, updatedAt: serverTimestamp() } },
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
              contestDate,
              timeStart,
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
              contestDate,
              timeStart,
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

  async function confirmContestJoin() {
    if (!contestJoinConfirm) return;
    await joinContest(contestJoinConfirm);
    setContestJoinConfirm(null);
  }

  async function confirmContestant(join: ContestJoin) {
    if (!isAdmin || join.status === "Qualified Contestant") return;
    setConfirmingJoinId(join.id);
    try {
      await getVerifiedAdmin();
      await updateDoc(doc(db, "contestJoins", join.id), { status: "Qualified Contestant" });
      setContestJoins((current) => current.map((item) => item.id === join.id ? { ...item, status: "Qualified Contestant" } : item));
      setToast({ kind: "success", text: `Contestant confirmed as qualified for ${join.contest}.` });
    } catch (error) {
      showError(error);
    } finally {
      setConfirmingJoinId("");
    }
  }

  async function deleteContent() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await getVerifiedAdmin();
      let refs: Array<{ collectionName: string; id: string }> = [];
      if (deleteTarget.kind === "program") {
        const [materialDocs, mechanicsDocs, joinDocs, speakerDocs] = await Promise.all([
          getDocs(query(collection(db, "materials"), where("programId", "==", deleteTarget.id))),
          getDocs(query(collection(db, "contestMechanics"), where("programId", "==", deleteTarget.id))),
          getDocs(query(collection(db, "contestJoins"), where("programId", "==", deleteTarget.id))),
          getDocs(query(collection(db, "speakers"), where("programId", "==", deleteTarget.id))),
        ]);
        refs = [
          { collectionName: "programs", id: deleteTarget.id },
          ...materialDocs.docs.map((entry) => ({ collectionName: "materials", id: entry.id })),
          ...mechanicsDocs.docs.map((entry) => ({ collectionName: "contestMechanics", id: entry.id })),
          ...joinDocs.docs.map((entry) => ({ collectionName: "contestJoins", id: entry.id })),
          ...speakerDocs.docs.map((entry) => ({ collectionName: "speakers", id: entry.id })),
        ];
      } else if (deleteTarget.kind === "mechanics") {
        const joinDocs = await getDocs(query(collection(db, "contestJoins"), where("contestId", "==", deleteTarget.id)));
        refs = [
          { collectionName: "contestMechanics", id: deleteTarget.id },
          ...joinDocs.docs.map((entry) => ({ collectionName: "contestJoins", id: entry.id })),
        ];
      } else {
        refs = [{ collectionName: deleteTarget.kind === "speaker" ? "speakers" : "materials", id: deleteTarget.id }];
      }
      for (let start = 0; start < refs.length; start += 450) {
        const batch = writeBatch(db);
        refs.slice(start, start + 450).forEach((entry) => batch.delete(doc(db, entry.collectionName, entry.id)));
        await batch.commit();
      }
      if (deleteTarget.kind === "program") {
        setToast({ kind: "success", text: "Program and its related content were deleted." });
      } else if (deleteTarget.kind === "mechanics") {
        setToast({ kind: "success", text: "Contest mechanics and associated joins were deleted." });
      } else if (deleteTarget.kind === "speaker") {
        setToast({ kind: "success", text: "Speaker profile deleted." });
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
    setAttendanceConfirmOpen(false);
    setToast({ kind: "success", text: "You have signed out." });
  }

  const navItems: { id: Section; label: string }[] = [
    ...(isApprovedMember ? [{ id: "programs" as Section, label: "Programs" }] : []),
    ...(isApprovedMember ? [{ id: "contests" as Section, label: "Contest" }] : []),
    ...(isAdmin ? [{ id: "contestMechanics" as Section, label: "Contest Mechanics" }] : []),
    ...(isAdmin ? [{ id: "speakers" as Section, label: "Speakers" }] : signedIn ? [{ id: "materials" as Section, label: "Resources" }] : []),
    ...(isAdmin ? [{ id: "manage" as Section, label: "Manage Content" }] : []),
    ...(isAdmin ? [{ id: "confirmedAttendees" as Section, label: "Confirmed Attendees" }] : []),
    ...(isSuperadmin ? [{ id: "approval" as Section, label: "User Approval" }] : []),
  ];

  return (
    <>
    <div
      className={`site-shell${section === "confirmedAttendees" ? " site-shell--confirmed-attendees" : ""}`}
      inert={loadingScreenVisible}
      aria-busy={loadingScreenVisible}
      onDragStartCapture={(event) => {
        if (event.target instanceof HTMLImageElement) event.preventDefault();
      }}
      onContextMenuCapture={(event) => {
        if (event.target instanceof HTMLImageElement) event.preventDefault();
      }}
    >
      <header className="topbar">
        <a href="/" className="brand" aria-label="AEW Congress home" onClick={(event) => { event.preventDefault(); window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); setSection("home"); }}>
          <span className="brand-mark"><img src="/AEW_logo_1.png" alt="" /></span>
          <span className="brand-wording"><strong>AEW <em>CONGRESS</em></strong><small>CARAGA REGION</small></span>
        </a>
        {signedIn && <nav className={`primary-nav ${mobileMenuOpen ? "primary-nav--open" : ""}`} aria-label="Primary navigation">
          {navItems.map((item) => <button key={item.id} className={section === item.id ? "nav-link nav-link--active" : "nav-link"} onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}>{item.label}{item.id === "approval" && profiles.filter((p) => p.emailVerified === true && p.status === "Pending").length > 0 && <span className="nav-count">{profiles.filter((p) => p.emailVerified === true && p.status === "Pending").length}</span>}</button>)}
        </nav>}
        <div className="topbar-actions">
          {signedIn ? <><span className="signed-in-label"><span className="online-dot" />{isSuperadmin ? "Superadmin" : isAdmin ? "Admin" : activeProfile?.firstName}</span><IconButton label="Sign out" onClick={logout}><LogOut size={18} /></IconButton></> : <button className="login-link" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}><span>Log in</span><span className="login-icon"><UserRound size={17} /></span></button>}
          {signedIn && <button className="mobile-menu-button" aria-label="Toggle navigation" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>}
        </div>
      </header>

      <main id="top">
        {section === "approval" && isSuperadmin ? (
          <ApprovalDashboard profiles={profiles} loading={loading} onChangeRole={changeRole} onChangeStatus={changeStatus} onAddProgram={() => openProgramEditor()} onAddMaterial={() => openMaterialEditor()} />
        ) : section === "manage" && isAdmin ? (
          <ManageDashboard programs={programs} materials={materials} mechanics={contestMechanics} onAddProgram={() => openProgramEditor()} onEditProgram={openProgramEditor} onDeleteProgram={(program) => setDeleteTarget({ kind: "program", id: program.id, label: program.eventTitle })} onAddMaterial={() => openMaterialEditor()} onEditMaterial={openMaterialEditor} onDeleteMaterial={(material) => setDeleteTarget({ kind: "material", id: material.id, label: material.name })} onToggleMaterialVisibility={toggleMaterialVisibility} onEditMechanics={openMechanicsEditor} onDeleteMechanics={(mechanics) => setDeleteTarget({ kind: "mechanics", id: mechanics.id, label: mechanics.contest })} onAddMechanics={() => openMechanicsEditor()} backLabel={isSuperadmin ? "Back to approvals" : "Back to home"} onBack={() => setSection(isSuperadmin ? "approval" : "home")} />
        ) : section === "confirmedAttendees" && isAdmin ? (
          <ConfirmedAttendeesPage programs={programs} selectedProgramId={selectedProgram?.id ?? ""} onSelectProgram={(id) => { setSelectedProgramId(id); setSelectedDay(0); }} confirmations={attendanceConfirmations} profiles={profiles} loading={attendanceConfirmationsLoading || profilesLoading} />
        ) : section === "contestMechanics" && isAdmin ? (
          <ContestMechanicsPage mechanics={contestMechanics} joins={contestJoins} profiles={profiles} contestantsLoading={contestJoinsLoading || profilesLoading} confirmingJoinId={confirmingJoinId} onConfirmContestant={confirmContestant} programs={programs} loading={contestMechanicsLoading} onAdd={() => openMechanicsEditor()} onEdit={openMechanicsEditor} onDelete={(mechanics) => setDeleteTarget({ kind: "mechanics", id: mechanics.id, label: mechanics.contest })} />
        ) : section === "contests" && isApprovedMember ? (
          <ContestsPage contests={contestMechanics} programs={programs} joinedContestIds={joinedContestIds} joinedContestStatuses={joinedContestStatuses} joiningContestId={joiningContestId} loading={contestMechanicsLoading} onJoin={(contest) => setContestJoinConfirm(contest)} />
        ) : section === "speakers" ? (
          <SpeakersPage speakers={speakers} programs={programs} isAdmin={isAdmin} loading={speakersLoading} onAdd={() => openSpeakerEditor()} onEdit={openSpeakerEditor} onDelete={(speaker) => setDeleteTarget({ kind: "speaker", id: speaker.id, label: speaker.name })} />
        ) : section === "materials" ? (
          <MaterialsPage materials={materials} programs={programs} isAdmin={isAdmin} isRegularMember={isRegularMember} onAdd={() => openMaterialEditor()} onDownload={downloadMaterial} loading={loading} />
        ) : (
          <>
            {section === "home" && <HomeLanding program={currentYearProgram} currentYear={currentYear} loading={loading} onExplorePrograms={() => setSection("programs")} onKnowSpeakers={() => setSection("speakers")} />}

            {section === "programs" && <>
            <section className="content-wrap program-section" id="program-list">
              <div className="section-heading"><div><span className="eyebrow">THE CALENDAR</span><h2>Programs <span>& gatherings</span></h2></div><div className="heading-side"><span className="section-count">{programs.length.toString().padStart(2, "0")} <span>{programs.length === 1 ? "PROGRAM" : "PROGRAMS"}</span></span>{isAdmin && <button className="button button--soft" onClick={() => openProgramEditor()}><Plus size={16} /> New program</button>}</div></div>
              <div className="program-cards">
                {programs.map((program, index) => <button key={program.id} className={`program-card ${selectedProgram?.id === program.id ? "program-card--selected" : ""}`} onClick={() => { setSelectedProgramId(program.id); setSelectedDay(0); }}>
                  <span className={`program-card-num program-card-num--${index % 3}`}>{String(index + 1).padStart(2, "0")}</span><div className="program-card-main"><span className="card-date"><CalendarDays size={13} />{dateRange(program.dateFrom, program.dateTo)}</span><h3>{program.eventTitle}</h3>{program.theme && <span className="program-card-theme">{program.theme}</span>}<span className="card-location"><MapPin size={13} />{program.venue}</span></div><span className="program-card-arrow"><ArrowUpRight size={18} /></span>
                </button>)}
              </div>
              {!programs.length && <div className="program-empty"><CalendarDays size={22} /><div><strong>{loading ? "Loading programs..." : "No programs have been published yet."}</strong><span>{loading ? "Published programs will appear here." : isAdmin ? "Add a program to share it with the community." : "Please check back later for upcoming programs."}</span></div>{isAdmin && !loading && <button className="button button--soft" onClick={() => openProgramEditor()}><Plus size={16} /> New program</button>}</div>}
            </section>

            {selectedProgram ? <section className="content-wrap schedule-section" id="schedule">
              <div className="schedule-topline"><div className="schedule-kicker"><span className="live-pill"><span />PROGRAM FLOW</span><span className="schedule-location"><MapPin size={13} />{selectedProgram?.venue}</span></div><div className="schedule-tools"><label className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions or people" aria-label="Search sessions or people" /><kbd>⌘ K</kbd></label>{isRegularMember && <button type="button" className={`button attendance-confirm-button ${attendanceConfirmed ? "attendance-confirm-button--done" : "button--olive"}`} disabled={attendanceChecking || attendanceConfirmed || attendanceSubmitting} onClick={() => setAttendanceConfirmOpen(true)}>{attendanceConfirmed ? <Check size={15} /> : <BadgeCheck size={15} />}{attendanceChecking ? "Checking attendance…" : attendanceConfirmed ? "Attendance Confirmed" : "Attendance Confirmation"}</button>}</div></div>
              <div className="schedule-title-row"><div><span className="eyebrow">THE DAILY FLOW</span><h2>{selectedProgram?.eventTitle}</h2>{selectedProgram?.theme && <p className="schedule-theme"><strong>Theme</strong>{selectedProgram.theme}</p>}<p>{selectedProgram?.description || `${dateRange(selectedProgram?.dateFrom ?? "", selectedProgram?.dateTo ?? "")} · ${selectedProgram?.flow.length ?? 0} sessions`}</p></div><div className="day-controls"><button className="day-arrow" aria-label="Previous day" disabled={selectedDay === 0} onClick={() => setSelectedDay(Math.max(0, selectedDay - 1))}><ChevronLeft size={17} /></button><div className="day-tabs">{days.map((day, index) => <button key={day} className={selectedDay === index ? "day-tab day-tab--active" : "day-tab"} onClick={() => setSelectedDay(index)}><span>DAY {String(index + 1).padStart(2, "0")}</span><small>{displayDate(day, { month: "short", day: "numeric" })}</small></button>)}</div><button className="day-arrow" aria-label="Next day" disabled={selectedDay >= days.length - 1} onClick={() => setSelectedDay(Math.min(days.length - 1, selectedDay + 1))}><ChevronRight size={17} /></button></div></div>
              <div className="schedule-meta"><span><CalendarDays size={15} />{displayDate(days[selectedDay] ?? "")}</span><span><Clock3 size={15} />{filteredSessions.length} sessions today</span><button onClick={() => setSearch("")}>Clear search <X size={12} /></button></div>
              <div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>TIME</th><th>SESSION</th><th>RESPONSIBLE</th></tr></thead><tbody>
                {scheduleRows.map(({ item, timeRowSpan, timeGroup, period, periodLabel }, index) => {
                  const periodKey = `${selectedProgram.id}:${item.date}:${period}`;
                  const periodExpanded = !period || expandedSessionPeriods.has(periodKey);
                  return <Fragment key={`${item.date}-${item.startTime ?? item.time}-${item.session}-${index}`}>
                    {periodLabel && <tr className="session-period-row"><th colSpan={3} scope="rowgroup"><button type="button" aria-expanded={periodExpanded} onClick={() => setExpandedSessionPeriods((current) => {
                      const next = new Set(current);
                      if (next.has(periodKey)) next.delete(periodKey);
                      else next.add(periodKey);
                      return next;
                    })}><ChevronRight size={14} />{periodLabel}</button></th></tr>}
                    {periodExpanded && <tr className={`session-row${hoveredTimeGroup === timeGroup ? " session-row--group-hovered" : ""}`} onMouseEnter={() => setHoveredTimeGroup(timeGroup)} onMouseLeave={() => setHoveredTimeGroup((current) => current === timeGroup ? null : current)} style={{ animationDelay: `${index * 45}ms` }}>{timeRowSpan > 0 && <td className="session-time" rowSpan={timeRowSpan}>{sessionTimeLabel(item)}</td>}<td className="session-name">{item.session}</td><td className="session-person"><SessionResponsibleDisplay item={item} /></td></tr>}
                  </Fragment>;
                })}
                {!filteredSessions.length && <tr><td colSpan={3} className="empty-table"><Search size={19} /><strong>No matching sessions</strong><span>Try a different search term.</span></td></tr>}
              </tbody></table></div>
              <div className="schedule-footer"><span><span className="footer-spark">✳</span>Every session is a chance to share what works.</span><button aria-label="Print schedule" title="Print the schedule or save as PDF" onClick={() => window.print()}><Printer size={15} /> Print</button></div>
            </section> : <section className="content-wrap schedule-empty" id="schedule"><CalendarDays size={23} /><span className="eyebrow">PROGRAM FLOW</span><h2>{loading ? "Loading program flow..." : "No program flow available yet."}</h2><p>{loading ? "The daily schedule will appear when program data loads." : "A daily schedule will appear here after a program is published."}</p>{isAdmin && !loading && <button className="button button--olive" onClick={() => openProgramEditor()}><Plus size={16} /> Create a program</button>}</section>}

            {signedIn && <MaterialsTeaser materials={isAdmin ? materials : materials.filter((material) => material.enabled !== false)} onOpen={() => setSection("materials")} onDownload={downloadMaterial} />}
            {cloudIssue && <div className="content-wrap cloud-notice"><CircleHelp size={16} /><span>Live data isn’t connected yet. {cloudIssue === "Missing or insufficient permissions." ? "Add the provided Firestore rules and enable sign-in in Firebase." : cloudIssue}</span></div>}
            </>}
          </>
        )}
      </main>


      {attendanceConfirmOpen && selectedProgram && <AttendanceConfirmationModal programTitle={selectedProgram.eventTitle} busy={attendanceSubmitting} onCancel={() => !attendanceSubmitting && setAttendanceConfirmOpen(false)} onConfirm={submitAttendanceConfirmation} />}
      {contestJoinConfirm && <ContestJoinConfirmationModal contestName={contestJoinConfirm.contest} eventTitle={contestJoinConfirm.eventTitle} busy={joiningContestId === contestJoinConfirm.id} onCancel={() => !joiningContestId && setContestJoinConfirm(null)} onConfirm={confirmContestJoin} />}
      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onLogin={handleLogin} onCreate={handleCreateAccount} onForgot={handleForgotPassword} />}
      {programModal && <ProgramModal key={editingProgram?.id ?? "new-program"} initialProgram={editingProgram} programs={programs} onClose={() => { setProgramModal(false); setEditingProgram(null); }} onCreate={createProgram} />}
      {contestMechanicsModal && <ContestMechanicsModal key={editingMechanics?.id ?? "new-mechanics"} programs={programs} initialMechanics={editingMechanics} onClose={() => { setContestMechanicsModal(false); setEditingMechanics(null); }} onCreate={createContestMechanics} />}
      {materialModal && <MaterialModal key={editingMaterial?.id ?? "new-material"} programs={programs} initialMaterial={editingMaterial} onClose={() => { setMaterialModal(false); setEditingMaterial(null); }} onCreate={createMaterial} busy={uploadBusy} />}
      {speakerModal && <SpeakerModal key={editingSpeaker?.id ?? "new-speaker"} programs={programs} initialSpeaker={editingSpeaker} onClose={() => { setSpeakerModal(false); setEditingSpeaker(null); }} onSave={createSpeaker} busy={uploadBusy} />}
      {deleteTarget && <DeleteConfirmModal target={deleteTarget} busy={deleteBusy} onClose={() => !deleteBusy && setDeleteTarget(null)} onConfirm={deleteContent} />}
      {toast && <div className={`toast toast--${toast.kind}`} role="status"><span className="toast-icon">{toast.kind === "success" ? <Check size={15} /> : toast.kind === "info" ? <CircleHelp size={15} /> : <X size={15} />}</span>{toast.text}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
    {loadingScreenVisible && <LoadingProgressScreen startedAt={loadingStartedAt} fadeOut={loadingFadeOut} showPercentage={Boolean(user?.emailVerified)} />}
    </>
  );
}

function ProgramFilterDropdown({ id, programs, value, onChange, className = "", label = "Program", allLabel = "All programs", choices }: {
  id: string;
  programs: Program[];
  value: string;
  onChange: (programId: string) => void;
  className?: string;
  label?: string;
  allLabel?: string;
  choices?: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [activeOption, setActiveOption] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const options = [{ id: "", label: allLabel }, ...(choices ?? programs.map((program) => ({ id: program.id, label: program.eventTitle })))];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setActiveOption(selectedIndex);
        setOpen(true);
      } else {
        setActiveOption((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      }
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveOption(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setActiveOption(selectedIndex);
        setOpen(true);
      } else {
        const option = options[activeOption];
        if (option) onChange(option.id);
        setOpen(false);
      }
    }
  }

  return <div className={`program-filter-dropdown ${className}`.trim()} ref={dropdownRef}>
    <span id={`${id}-label`}>{label}</span>
    <button ref={triggerRef} type="button" role="combobox" aria-autocomplete="none" className="speakers-filter-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${activeOption}` : undefined} onClick={() => { if (!open) setActiveOption(selectedIndex); setOpen((current) => !current); }} onKeyDown={handleKeyDown}>
      <span id={`${id}-value`}>{options.find((option) => option.id === value)?.label ?? allLabel}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="speakers-filter-menu" id={`${id}-options`} role="listbox" aria-label={label}>
      {options.map((option, index) => <button className={`speakers-filter-option${index === activeOption ? " speakers-filter-option--active" : ""}`} id={`${id}-option-${index}`} key={option.id || "all-programs"} type="button" role="option" aria-selected={option.id === value} onMouseEnter={() => setActiveOption(index)} onClick={() => { onChange(option.id); setOpen(false); triggerRef.current?.focus(); }}>
        <span>{option.label}</span>{option.id === value && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}

function SpeakersPage({ speakers, programs, isAdmin, loading, onAdd, onEdit, onDelete }: {
  speakers: SpeakerProfileCard[];
  programs: Program[];
  isAdmin: boolean;
  loading: boolean;
  onAdd: () => void;
  onEdit: (speaker: SpeakerProfileCard) => void;
  onDelete: (speaker: SpeakerProfileCard) => void;
}) {
  const [programFilter, setProgramFilter] = useState("");
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [keynoteFilter, setKeynoteFilter] = useState("");
  const programsById = new Map(programs.map((program) => [program.id, program]));
  const programSpeakers = useMemo(() => speakers.filter((speaker) => !programFilter || speaker.programId === programFilter), [programFilter, speakers]);
  const speakerDays = useMemo(() => {
    const dateSet = new Set<string>();
    const matchingPrograms = programs.filter((program) => !programFilter || program.id === programFilter);
    matchingPrograms.forEach((program) => {
      const first = new Date(`${program.dateFrom}T12:00:00`);
      const last = new Date(`${program.dateTo}T12:00:00`);
      let dayCount = 0;
      for (const day = new Date(first); day <= last && dayCount < 31; day.setDate(day.getDate() + 1), dayCount += 1) {
        dateSet.add(day.toISOString().slice(0, 10));
      }
      if (!dayCount && program.dateFrom) dateSet.add(program.dateFrom);
    });
    programSpeakers.forEach((speaker) => (speaker.keynoteSessions ?? []).forEach((item) => {
      if (item.date) dateSet.add(item.date);
    }));
    return [...dateSet].sort();
  }, [programFilter, programSpeakers, programs]);
  const selectedDate = selectedDayIndex >= 0 ? speakerDays[selectedDayIndex] ?? "" : "";
  const savedKeynoteOptions = [...new Set(programSpeakers.flatMap((speaker) => (speaker.keynoteSessions ?? [])
    .map((item) => item.session.trim())
    .filter(Boolean)))].sort((a, b) => a.localeCompare(b));
  const displayed = programSpeakers.filter((speaker) => {
    const sessions = speaker.keynoteSessions ?? [];
    const matchesDay = !selectedDate || sessions.some((item) => item.date === selectedDate);
    const matchesKeynote = !keynoteFilter || sessions.some((item) => item.session === keynoteFilter && (!selectedDate || item.date === selectedDate));
    return matchesDay && matchesKeynote;
  });
  const scheduleFilterActive = Boolean(selectedDate || keynoteFilter);
  const visibleDayStart = Math.max(0, Math.min(Math.max(0, selectedDayIndex - 1), speakerDays.length - 3));
  const visibleDays = speakerDays.slice(visibleDayStart, visibleDayStart + 3);

  return <div className="content-wrap dashboard-page speakers-page">
    <div className="section-heading speakers-heading">
      <div><span className="eyebrow">LEARN · SHARE · GROW</span><h2>Know the <span>Speakers</span></h2><p>Meet the people bringing practical knowledge to our programs.</p></div>
      <div className="speakers-controls">
        <ProgramFilterDropdown id="speaker-program-filter" programs={programs} value={programFilter} onChange={(value) => { setProgramFilter(value); setSelectedDayIndex(0); setKeynoteFilter(""); }} />
        {isAdmin && <button className="button button--olive" disabled={!programs.length} onClick={onAdd}><Plus size={16} /> Add speaker</button>}
      </div>
    </div>
    {!isAdmin && <div className="speakers-secondary-filters">
      <div className="speakers-day-filter"><span className="eyebrow">DAILY FILTER</span><div className="day-controls speakers-day-controls"><button className="day-arrow" aria-label="Previous speaker day" disabled={selectedDayIndex <= 0} onClick={() => setSelectedDayIndex((current) => Math.max(0, current - 1))}><ChevronLeft size={17} /></button><div className="day-tabs speakers-day-tabs">{visibleDays.map((day, index) => { const dayIndex = visibleDayStart + index; return <button key={day} className={selectedDayIndex === dayIndex ? "day-tab day-tab--active" : "day-tab"} onClick={() => setSelectedDayIndex(dayIndex)}><span>DAY {String(dayIndex + 1).padStart(2, "0")}</span><small>{displayDate(day, { month: "short", day: "numeric" })}</small></button>; })}</div><button className="day-arrow" aria-label="Next speaker day" disabled={!speakerDays.length || selectedDayIndex >= speakerDays.length - 1} onClick={() => setSelectedDayIndex((current) => Math.min(speakerDays.length - 1, current + 1))}><ChevronRight size={17} /></button></div></div>
      <ProgramFilterDropdown id="speaker-keynote-filter" programs={programs} value={keynoteFilter} label="Keynote Session" allLabel="All keynote sessions" choices={savedKeynoteOptions.map((session) => ({ id: session, label: session }))} className="speaker-keynote-filter" onChange={setKeynoteFilter} />
    </div>}
    <div className="speakers-count-row"><span>{String(displayed.length).padStart(2, "0")} SPEAKERS</span><i /> <span>{programFilter ? programsById.get(programFilter)?.eventTitle : "CARAGA REGION XIII"}</span></div>
    <div className="speaker-card-grid">{displayed.map((speaker, index) => {
      const displayName = `${speaker.name.toLocaleUpperCase()}${speaker.postNominal?.trim() ? `, ${speaker.postNominal.trim()}` : ""}`;
      return <article className="speaker-profile-card" key={speaker.id} style={{ animationDelay: `${index * 45}ms` }}>
        <div className="speaker-profile-photo">
          <img src={speaker.imageUrl} alt={`${speaker.name} profile`} loading="lazy" />
          {isAdmin && <div className="speaker-profile-actions"><button type="button" aria-label={`Edit ${speaker.name}`} title="Edit profile" onClick={() => onEdit(speaker)}><Pencil size={15} /></button><button type="button" aria-label={`Delete ${speaker.name}`} title="Delete profile" onClick={() => onDelete(speaker)}><Trash2 size={15} /></button></div>}
          <div className="speaker-profile-title"><span className="eyebrow">CONGRESS SPEAKER</span><h3 title={displayName}>{displayName}</h3><p><span>{speaker.designation}</span><i />{speaker.office}</p></div>
        </div>
        <div className="speaker-profile-details">
          {!!speaker.affiliations?.length && <section className="speaker-detail-section"><div className="speaker-affiliations">{speaker.affiliations.map((item, positionIndex) => <p key={`${item.position}-${item.organization}-${positionIndex}`}><strong>{item.position}</strong><i />{item.organization}</p>)}</div></section>}
          {!!speaker.topics?.length && <section className="speaker-detail-section speaker-topics-section"><span>{speaker.topics.length === 1 ? "TOPIC" : "TOPICS"}</span><div className="speaker-topic-list">{speaker.topics.map((topic, topicIndex) => <span key={`${topic}-${topicIndex}`}>{topic}</span>)}</div></section>}
        </div>
      </article>;
    })}</div>
    {!displayed.length && <div className="speakers-empty"><span><UsersRound size={22} /></span><span className="eyebrow">A PLACE FOR EVERY VOICE</span><h2>{loading ? "Gathering speaker profiles…" : scheduleFilterActive ? "No speakers match these filters." : programFilter ? "No speakers for this program yet" : "Meet the speakers soon."}</h2><p>{loading ? "Saved speaker profiles will appear here." : scheduleFilterActive ? "Choose another day or keynote session, or clear a filter to see more speakers." : programFilter ? "Choose another program or check back when speakers are added." : "Speaker profiles shared by the admin team will appear here."}</p>{isAdmin && !loading && <button className="button button--olive" disabled={!programs.length} onClick={onAdd}><Plus size={15} /> Add the first speaker</button>}</div>}
  </div>;
}

function HomeLanding({ program, currentYear, loading, onExplorePrograms, onKnowSpeakers }: { program: Program | null; currentYear: number; loading: boolean; onExplorePrograms: () => void; onKnowSpeakers: () => void }) {
  const eventTitle = program?.eventTitle || `AEW Congress ${currentYear}`;
  const eventDates = program?.dateFrom && program?.dateTo
    ? dateRange(program.dateFrom, program.dateTo)
    : loading ? "Loading this year’s program…" : "Dates to be announced";
  const eventVenue = program?.venue || (loading ? "Loading venue…" : "Venue to be announced");
  const eventTheme = program?.theme || (loading ? "Loading this year’s theme…" : "Theme to be announced");
  const eventDescription = program?.description?.trim() || (loading ? "Loading the program description…" : "Program description to be announced.");
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
          <h1 className="landing-hero-theme">{eventTheme}</h1>
          <p>{eventDescription}</p>
          <div className="landing-hero-actions">
            <button className="button button--olive" onClick={onExplorePrograms}>Explore the program <ArrowRight size={16} /></button>
            <button className="text-action" onClick={onKnowSpeakers}>Know the Speakers <ArrowRight size={16} /></button>
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

function AttendanceConfirmationModal({ programTitle, busy, onCancel, onConfirm }: {
  programTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="modal-backdrop attendance-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel(); }}>
    <section className="attendance-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-confirm-title">
      <div className="attendance-confirm-icon"><CalendarDays size={21} /></div>
      <span className="eyebrow">ATTENDANCE CONFIRMATION</span>
      <h2 id="attendance-confirm-title">Are you sure you want to attend the program?</h2>
      <p>{programTitle}</p>
      <div className="attendance-confirm-actions">
        <button className="button button--soft" type="button" autoFocus disabled={busy} onClick={onCancel}>No</button>
        <button className="button button--olive" type="button" disabled={busy} onClick={onConfirm}>{busy ? "Saving…" : "Yes"}</button>
      </div>
    </section>
  </div>;
}

function ContestJoinConfirmationModal({ contestName, eventTitle, busy, onCancel, onConfirm }: {
  contestName: string;
  eventTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="modal-backdrop attendance-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel(); }}>
    <section className="attendance-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="contest-join-confirm-title">
      <div className="attendance-confirm-icon"><UsersRound size={21} /></div>
      <span className="eyebrow">CONTEST REGISTRATION</span>
      <h2 id="contest-join-confirm-title">Are you sure you want to join this contest?</h2>
      <p><strong>{contestName}</strong><br />{eventTitle}</p>
      <div className="attendance-confirm-actions">
        <button className="button button--soft" type="button" autoFocus disabled={busy} onClick={onCancel}>No</button>
        <button className="button button--olive" type="button" disabled={busy} onClick={onConfirm}>{busy ? "Joining…" : "Yes"}</button>
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
  const [privacyConsentOpen, setPrivacyConsentOpen] = useState(false);
  const createFormRef = useRef<HTMLFormElement>(null);
  const consentApproved = useRef(false);
  const today = new Date().toISOString().slice(0, 10);
  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    if (!consentApproved.current) {
      event.preventDefault();
      setPrivacyConsentOpen(true);
      return;
    }
    consentApproved.current = false;
    onCreate(event);
  }
  function confirmPrivacyConsent() {
    consentApproved.current = true;
    setPrivacyConsentOpen(false);
    window.requestAnimationFrame(() => createFormRef.current?.requestSubmit());
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="auth-modal" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create an account" : mode === "reset" ? "Reset your password" : "Log in"}>
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
      <div className="auth-side auth-side--form">
        <div className="auth-mobile-brand"><img src="/AEW_logo_1.png" alt="AEW" /><span>AEW <strong>CONGRESS</strong></span></div>
        <div className="auth-heading">{mode !== "create" && <span className="eyebrow">{mode === "reset" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</span>}<h2>{mode === "create" ? <>Create your<br />account<span>.</span></> : mode === "reset" ? <>Reset your<br />password<span>.</span></> : <>Your next chapter<br />starts here<span>.</span></>}</h2><p>{mode === "create" ? "Register once your office is ready to join the learning exchange." : mode === "reset" ? "We’ll send a secure reset link to the email on your account." : "Sign in to access your programs and shared materials."}</p></div>
        {mode === "login" ? <form className="auth-form login-form" onSubmit={onLogin}>
          <Field label="Email address" icon={<UserRound size={15} />}><input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email here" required /></Field>
          <Field label="Password" icon={<LockKeyhole size={15} />}><input type={showPassword ? "text" : "password"} name="password" autoComplete="current-password" placeholder="Enter your password" required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></Field>
          <div className="auth-form-row"><span className="secure-note"><ShieldCheck size={13} /> Protected access</span><button type="button" className="forgot-link" onClick={() => setMode("reset")}>Forgot password?</button></div>
          <button className="button button--olive button--wide" type="submit">Log in <ArrowRight size={16} /></button>
          <p className="auth-switch">New to AEW Congress? <button type="button" onClick={() => setMode("create")}>Create an account</button></p>
        </form> : mode === "reset" ? <form className="auth-form login-form reset-form" onSubmit={(event) => { event.preventDefault(); onForgot(email); }}>
          <Field label="Email address" icon={<Mail size={15} />}><input type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email here" required /></Field>
          <div className="reset-note"><LockKeyhole size={15} /><span>For your privacy, we’ll show the same confirmation whether or not an account exists.</span></div>
          <button className="button button--olive button--wide" type="submit">Send reset link <ArrowRight size={16} /></button>
          <p className="auth-switch">Remembered your password? <button type="button" onClick={() => setMode("login")}>Back to log in</button></p>
        </form> : <form ref={createFormRef} className="auth-form create-form" onSubmit={handleCreateSubmit}>
          <div className="form-section-label">PERSONAL DETAILS <span>01 / 02</span></div>
          <div className="form-grid form-grid--four"><Field label="First name"><input name="firstName" autoComplete="given-name" placeholder="First name" required /></Field><Field label="Middle name"><input name="middleName" autoComplete="additional-name" placeholder="Middle name" /></Field><Field label="Last name"><input name="lastName" autoComplete="family-name" placeholder="Last name" required /></Field><Field label="Suffix"><select name="suffix"><option value="">—</option>{suffixes.map((suffix) => <option key={suffix}>{suffix}</option>)}</select></Field></div>
          <div className="form-grid form-grid--three"><Field label="Birthdate"><input type="date" name="birthdate" max={today} required /></Field><Field label="Sex at birth"><select name="sexAtBirth" required defaultValue=""><option value="" disabled>Select</option><option>Male</option><option>Female</option></select></Field><Field label="Contact number"><div className="phone-input"><span>+63 9</span><input name="phone" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="XX XXX XXXX" maxLength={9} required /></div></Field></div>
          <div className="form-section-label form-section-label--spaced">WORK DETAILS <span>02 / 02</span></div>
          <div className="form-grid form-grid--three"><Field label="Position"><input name="position" placeholder="e.g. Agriculturist II" required /></Field><Field label="Designation"><input name="designation" placeholder="e.g. Municipal AEW" required /></Field><Field label="Office"><input name="office" placeholder="Office or organization" required /></Field></div>
          <div className="form-grid form-grid--three"><Field label="Email address"><input type="email" name="email" autoComplete="email" placeholder="Your email here" required /></Field><Field label="Password"><div className="password-field"><input type={showPassword ? "text" : "password"} name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field><Field label="Confirm password"><div className="password-field"><input type={showConfirmation ? "text" : "password"} name="confirmation" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Re-enter password" required /><button className="password-toggle" type="button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? "Hide password" : "Show password"}>{showConfirmation ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field></div>
          <button className="button button--olive button--wide" type="submit">Submit for approval <ArrowRight size={16} /></button>
          <p className="auth-switch">Already registered? <button type="button" onClick={() => setMode("login")}>Log in</button></p>
        </form>}
      </div>
      <aside className="auth-side auth-side--art" aria-label="Illustrated farmers working in an agricultural landscape"><img src="/right.png" alt="" /></aside>
      {privacyConsentOpen && <DataPrivacyConsentModal onCancel={() => setPrivacyConsentOpen(false)} onConfirm={confirmPrivacyConsent} />}
    </div>
  </div>;
}

function DataPrivacyConsentModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return <div className="auth-policy-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="form-modal auth-policy-modal" role="alertdialog" aria-modal="true" aria-labelledby="privacy-consent-title" aria-describedby="privacy-consent-copy">
      <div className="form-modal-head"><div><span className="eyebrow">REGISTRATION CONSENT</span><h2 id="privacy-consent-title">Data Privacy Consent &amp; Terms of Service</h2></div></div>
      <div className="auth-policy-copy" id="privacy-consent-copy">
        <p>By confirming this and submitting this registration, I certify that the information provided is accurate and complete.</p>
        <p>In compliance with the Data Privacy Act of 2012 (R.A. 10173), I freely and explicitly give my consent to DA-RFO XIII to collect, process, store, and verify my personal and sensitive personal information solely for the purposes of account creation, identity verification, and administrative approval.</p>
        <p>I acknowledge that I have read and agree to the Privacy Policy.</p>
      </div>
      <div className="form-modal-actions auth-policy-actions">
        <button type="button" className="button button--soft" autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="button button--olive" onClick={onConfirm}>Agree and submit</button>
      </div>
    </section>
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
    <section className="approval-panel"><div className="panel-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h2>User Approval <span>& directory</span></h2><p>Verified accounts appear here as Pending. Approve an account to unlock member access.</p></div><div className="approval-filter">{["Pending", "Approved", "Disapproved", "All"].map((status) => <button key={status} className={filter === status ? "filter-chip filter-chip--active" : "filter-chip"} onClick={() => setFilter(status)}>{status}{status === "Pending" && <span>{counts.Pending}</span>}</button>)}</div></div>
      <div className="approval-table-wrap"><table className="approval-table"><thead><tr><th>NAME / EMAIL</th><th>DESIGNATION</th><th>OFFICE</th><th>CONTACT NO.</th><th>ROLE</th><th>STATUS</th></tr></thead><tbody>
        {filtered.map((profile) => <tr key={profile.uid}><td><div className="user-cell"><span className="user-avatar">{nameInitials(profile)}</span><span><strong>{fullName(profile)}</strong><small>{profile.email}</small></span></div></td><td><strong className="table-primary">{profile.designation || profile.position}</strong><small className="table-muted">{profile.position}</small></td><td>{profile.office}</td><td>{profile.contactNo}</td><td><select aria-label={`Role for ${fullName(profile)}`} className={`role-select role-select--${profileRole(profile)}`} value={profileRole(profile)} disabled={profile.email.toLowerCase() === SUPERADMIN_EMAIL} onChange={(event) => onChangeRole(profile, event.target.value as UserRole)}><option value="superadmin">superadmin</option><option value="admin">admin</option><option value="regular">regular</option></select></td><td><select aria-label={`Status for ${fullName(profile)}`} className={`status-select status-select--${profile.status.toLowerCase()}`} value={profile.status} onChange={(event) => onChangeStatus(profile, event.target.value as UserProfile["status"])}><option>Pending</option><option>Approved</option><option>Disapproved</option></select></td></tr>)}
        {!filtered.length && <tr><td colSpan={6} className="empty-table"><UsersRound size={20} /><strong>{loading ? "Loading registrations…" : "No accounts in this view"}</strong><span>{loading ? "Your directory will appear in a moment." : "New registrations will show up here."}</span></td></tr>}
      </tbody></table></div><div className="table-footnote"><span><LockKeyhole size={13} /> Personal details are private to superadmins.</span><span>{filtered.length} {filtered.length === 1 ? "account" : "accounts"}</span></div>
    </section>
  </div>;
}

function ConfirmedAttendeesPage({ programs, selectedProgramId, onSelectProgram, confirmations, profiles, loading }: {
  programs: Program[];
  selectedProgramId: string;
  onSelectProgram: (id: string) => void;
  confirmations: AttendanceConfirmation[];
  profiles: UserProfile[];
  loading: boolean;
}) {
  const profilesById = new Map(profiles.map((profile) => [profile.uid, profile]));
  const attendees = confirmations
    .filter((confirmation) => confirmation.programId === selectedProgramId)
    .flatMap((confirmation) => {
      const profile = profilesById.get(confirmation.uid);
      return profile && profileRole(profile) === "regular" ? [profile] : [];
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const selectedProgram = programs.find((program) => program.id === selectedProgramId);

  return <div className="content-wrap dashboard-page confirmed-attendees-page">
    <div className="section-heading">
      <div><span className="eyebrow">ADMIN WORKSPACE</span><h2>Confirmed <span>Attendees</span></h2><p>Regular users who confirmed they plan to attend.</p></div>
      <div className="confirmed-attendees-controls">
        <label className="confirmed-attendees-program"><span>Program</span><select value={selectedProgramId} onChange={(event) => onSelectProgram(event.target.value)} disabled={!programs.length}>
          {!programs.length && <option value="">No programs available</option>}
          {programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle}</option>)}
        </select></label>
        <button type="button" className="button button--soft confirmed-attendees-print" onClick={() => window.print()} disabled={!selectedProgram}>
          <Printer size={15} /> Print
        </button>
      </div>
    </div>
    <section className="approval-panel">
      <div className="panel-heading"><div><span className="eyebrow">ATTENDANCE</span><h2>{selectedProgram?.eventTitle ?? "Program attendees"}</h2><p>{selectedProgram ? "Confirmed attendance for this program." : "Publish a program to collect attendance confirmations."}</p></div><span className="confirmed-attendees-count">{attendees.length} {attendees.length === 1 ? "attendee" : "attendees"}</span></div>
      <div className="approval-table-wrap"><table className="approval-table confirmed-attendees-table"><thead><tr><th>NAME</th><th>POSITION</th><th>DESIGNATION</th><th>OFFICE</th><th>EMAIL</th><th>CONTACT NUMBER</th></tr></thead><tbody>
        {attendees.map((profile) => <tr key={profile.uid}><td><strong className="table-primary">{fullName(profile)}</strong></td><td>{profile.position || "—"}</td><td>{profile.designation || "—"}</td><td>{profile.office || "—"}</td><td>{profile.email}</td><td>{profile.contactNo || "—"}</td></tr>)}
        {!attendees.length && <tr><td colSpan={6} className="empty-table"><UsersRound size={20} /><strong>{loading ? "Loading confirmations…" : selectedProgram ? "No confirmed attendees yet" : "No program selected"}</strong><span>{loading ? "Confirmed attendees will appear here." : "This list updates when regular users confirm attendance."}</span></td></tr>}
      </tbody></table></div>
      <div className="table-footnote"><span><LockKeyhole size={13} /> Attendee details are visible to admins.</span><span>{attendees.length} confirmed</span></div>
    </section>
  </div>;
}

function ManageDashboard({ programs, materials, mechanics, onAddProgram, onEditProgram, onDeleteProgram, onAddMaterial, onEditMaterial, onDeleteMaterial, onToggleMaterialVisibility, onAddMechanics, onEditMechanics, onDeleteMechanics, backLabel, onBack }: {
  programs: Program[]; materials: Material[]; mechanics: ContestMechanics[];
  onAddProgram: () => void; onEditProgram: (program: Program) => void; onDeleteProgram: (program: Program) => void;
  onAddMaterial: () => void; onEditMaterial: (material: Material) => void; onDeleteMaterial: (material: Material) => void; onToggleMaterialVisibility: (material: Material) => void;
  onAddMechanics: () => void; onEditMechanics: (mechanics: ContestMechanics) => void; onDeleteMechanics: (mechanics: ContestMechanics) => void; backLabel: string; onBack: () => void;
}) {
  const actions = (label: string, onEdit: () => void, onDelete: () => void, visibility?: { enabled: boolean; onToggle: () => void }) => <div className="manage-row-actions"><button className="manage-action-button" aria-label={`Edit ${label}`} title="Edit" onClick={onEdit}><Pencil size={15} /></button>{visibility && <button type="button" className={`manage-action-button ${visibility.enabled ? "manage-action-button--visible" : "manage-action-button--hidden"}`} aria-label={visibility.enabled ? `Hide ${label} from regular users` : `Show ${label} to regular users`} aria-pressed={visibility.enabled} title={visibility.enabled ? "Visible to regular users — click to hide" : "Hidden from regular users — click to show"} onClick={visibility.onToggle}>{visibility.enabled ? <Eye size={15} /> : <EyeOff size={15} />}</button>}<button className="manage-action-button manage-action-button--delete" aria-label={`Delete ${label}`} title="Delete" onClick={onDelete}><Trash2 size={15} /></button></div>;
  return <div className="content-wrap dashboard-page"><button className="back-link" onClick={onBack}><ChevronLeft size={16} /> {backLabel}</button><div className="section-heading"><div><span className="eyebrow">ADMIN CONTENT MANAGEMENT</span><h2>Manage <span>content</span></h2><p>Create, review, edit, and remove programs, contests, and materials.</p></div></div><div className="manage-grid">
    <div className="manage-card"><div className="manage-card-heading"><div><CalendarDays size={18} /><h3>Programs</h3></div><button className="button button--soft" onClick={onAddProgram}><Plus size={15} /> Add</button></div>{programs.map((program) => <div className="manage-row" key={program.id}><div><strong>{program.eventTitle}</strong><small>{dateRange(program.dateFrom, program.dateTo)} · {program.venue}</small>{program.theme && <small>{program.theme}</small>}</div><span>{program.flow.length} sessions</span>{actions(program.eventTitle, () => onEditProgram(program), () => onDeleteProgram(program))}</div>)}{!programs.length && <p className="manage-empty">No programs have been published yet.</p>}</div>
    <div className="manage-card"><div className="manage-card-heading"><div><FileText size={18} /><h3>Contest mechanics</h3></div><button className="button button--soft" onClick={onAddMechanics}><Plus size={15} /> Add</button></div>{mechanics.map((item) => <div className="manage-row" key={item.id}><div><strong>{item.contest}</strong><small>{item.eventTitle} · {item.criteria?.length ?? 0} criteria</small></div><span>{contestWeightTotal(item.criteria)}%</span>{actions(item.contest, () => onEditMechanics(item), () => onDeleteMechanics(item))}</div>)}{!mechanics.length && <p className="manage-empty">No contest mechanics have been added yet.</p>}</div>
    <div className="manage-card"><div className="manage-card-heading"><div><FileCheck2 size={18} /><h3>Materials</h3></div><button className="button button--soft" onClick={onAddMaterial}><Plus size={15} /> Add</button></div>{materials.map((material) => <div className="manage-row" key={material.id}><div><strong>{material.name}</strong><small>{material.programTitle} · {material.category}</small></div><a href={material.url} target="_blank" rel="noreferrer" aria-label={`Open ${material.name}`}><ArrowUpRight size={15} /></a>{actions(material.name, () => onEditMaterial(material), () => onDeleteMaterial(material), { enabled: material.enabled !== false, onToggle: () => onToggleMaterialVisibility(material) })}</div>)}{!materials.length && <p className="manage-empty">The resource library is ready for its first upload.</p>}</div>
  </div></div>;
}

function contestWeightTotal(criteria: ContestMechanics["criteria"] = []) {
  return criteria.reduce((total, item) => total + (Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0), 0);
}

function ContestMechanicsPage({ mechanics, joins, profiles, contestantsLoading, confirmingJoinId, onConfirmContestant, programs, loading, onAdd, onEdit, onDelete }: {
  mechanics: ContestMechanics[]; joins: ContestJoin[]; profiles: UserProfile[]; contestantsLoading: boolean; confirmingJoinId: string; onConfirmContestant: (join: ContestJoin) => void; programs: Program[]; loading: boolean; onAdd: () => void; onEdit: (mechanics: ContestMechanics) => void; onDelete: (mechanics: ContestMechanics) => void;
}) {
  const [viewingContestants, setViewingContestants] = useState<ContestMechanics | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const filteredMechanics = (selectedProgramId ? mechanics.filter((item) => item.programId === selectedProgramId) : mechanics).slice().sort(compareContestSchedule);
  const profilesByUid = new Map(profiles.map((profile) => [profile.uid, profile]));
  const selectedJoins = viewingContestants ? joins.filter((join) => join.contestId === viewingContestants.id) : [];
  const sortedJoins = selectedJoins.slice().sort((a, b) => {
    const nameA = fullName(profilesByUid.get(a.uid) ?? {}).toLowerCase();
    const nameB = fullName(profilesByUid.get(b.uid) ?? {}).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  return <>
    <div className="content-wrap dashboard-page contest-page">
      <div className="section-heading contest-heading"><div><span className="eyebrow">ADMIN WORKSPACE</span><h2>Contest <span>& mechanics</span></h2><p>Set contest criteria and review the members who joined each contest.</p></div><button className="button button--olive" onClick={onAdd}><Plus size={16} /> Add mechanics</button></div>
      <section className="approval-panel contest-panel"><div className="panel-heading contest-panel-heading"><div><span className="eyebrow">CONTEST DIRECTORY</span><h2>Published mechanics</h2><p>View each contest's criteria and registered contestants.</p></div><div className="contest-panel-controls"><label className="contest-program-filter"><span>Program</span><select value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)} aria-label="Filter contests by program"><option value="">All programs</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle}</option>)}</select></label><span className="contest-count">{String(filteredMechanics.length).padStart(2, "0")} {filteredMechanics.length === 1 ? "CONTEST" : "CONTESTS"}</span></div></div>
        <div className="approval-table-wrap"><table className="approval-table contest-table contest-table--directory"><thead><tr><th>CONTEST</th><th>CONTESTANTS</th><th>ACTIONS</th></tr></thead><tbody>
          {filteredMechanics.map((item) => {
            const contestantCount = joins.filter((join) => join.contestId === item.id).length;
            return <tr key={item.id}><td><strong className="table-primary">{item.contest}</strong></td><td><div className="contestant-view-cell"><span>{contestantCount} joined</span><button className="contest-view" aria-label={`View contestants for ${item.contest}`} onClick={() => setViewingContestants(item)}><Eye size={15} />View</button></div></td><td><div className="manage-row-actions"><button className="manage-action-button" aria-label={`Edit ${item.contest}`} title="Edit" onClick={() => onEdit(item)}><Pencil size={15} /></button><button className="manage-action-button manage-action-button--delete" aria-label={`Delete ${item.contest}`} title="Delete" onClick={() => onDelete(item)}><Trash2 size={15} /></button></div></td></tr>;
          })}
          {!filteredMechanics.length && <tr><td colSpan={5} className="empty-table"><FileCheck2 size={20} /><strong>{loading ? "Loading contest mechanics…" : selectedProgramId ? "No contest mechanics for this program" : "No contest mechanics yet"}</strong><span>{loading ? "Saved contests will appear here." : selectedProgramId ? "Add contest mechanics for this program to see them here." : programs.length ? "Add the criteria and scoring details for a program contest." : "Publish a program before adding contest mechanics."}</span></td></tr>}
        </tbody></table></div><div className="table-footnote"><span><ShieldCheck size={13} /> Only verified admins can view contestant details and edit contest mechanics.</span><span>{filteredMechanics.length} {filteredMechanics.length === 1 ? "contest" : "contests"}</span></div>
      </section>
    </div>
    {viewingContestants && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !confirmingJoinId) setViewingContestants(null); }}><section className="form-modal contestants-modal" role="dialog" aria-modal="true" aria-labelledby="contestants-modal-title"><div className="form-modal-head"><div><span className="eyebrow">CONTESTANTS</span><h2 id="contestants-modal-title">{viewingContestants.contest}<span>.</span></h2><p>{viewingContestants.eventTitle} · {dateRange(viewingContestants.dateFrom, viewingContestants.dateTo)}</p></div><button className="modal-close modal-close--inline" onClick={() => !confirmingJoinId && setViewingContestants(null)} aria-label="Close contestants list"><X size={19} /></button></div><div className="contestants-table-wrap"><table className="approval-table contestants-table"><thead><tr><th>NAME</th><th>DESIGNATION</th><th>OFFICE</th><th>CONTACT NO.</th><th>STATUS / CONFIRM</th></tr></thead><tbody>{contestantsLoading ? <tr><td colSpan={5} className="empty-table">Loading contestants…</td></tr> : sortedJoins.length ? sortedJoins.map((join) => {
      const profile = profilesByUid.get(join.uid);
      const qualified = join.status === "Qualified Contestant";
      return <tr key={join.id}><td><strong className="table-primary">{profile ? fullName(profile) || "Member" : "Member profile unavailable"}</strong></td><td>{profile?.designation || "—"}</td><td>{profile?.office || "—"}</td><td>{profile?.contactNo || "—"}</td><td><div className="contestant-confirm-cell">{qualified ? <span className="qualified-contestant">Qualified Contestant</span> : <><span className="table-muted">Joined</span><button className="button button--soft contestant-confirm-button" disabled={Boolean(confirmingJoinId)} onClick={() => onConfirmContestant(join)}>{confirmingJoinId === join.id ? "Confirming…" : "Confirm"}</button></>}</div></td></tr>;
    }) : <tr><td colSpan={5} className="empty-table"><UsersRound size={20} /><strong>No contestants yet</strong><span>Members who join this contest will appear here.</span></td></tr>}</tbody></table></div><div className="form-modal-actions"><button className="button button--soft" disabled={Boolean(confirmingJoinId)} onClick={() => setViewingContestants(null)}>Close</button></div></section></div>}
  </>;
}

function ContestsPage({ contests, programs, joinedContestIds, joinedContestStatuses, joiningContestId, loading, onJoin }: {
  contests: ContestMechanics[]; programs: Program[]; joinedContestIds: string[]; joinedContestStatuses: Record<string, string>; joiningContestId: string; loading: boolean; onJoin: (contest: ContestMechanics) => void;
}) {
  const [selectedContestId, setSelectedContestId] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const displayedContests = contests.filter((contest) => !selectedProgramId || contest.programId === selectedProgramId).slice().sort(compareContestSchedule);
  const selectedContest = displayedContests.find((contest) => contest.id === selectedContestId);
  return <div className="content-wrap dashboard-page contest-page">
    <div className="section-heading contest-heading"><div><span className="eyebrow">LEARN · SHARE · GROW</span><h2>Contests <span>& opportunities</span></h2><p>Explore program contests, review their mechanics, and join when you’re ready.</p></div><span className="contest-count">{String(displayedContests.length).padStart(2, "0")} {displayedContests.length === 1 ? "CONTEST" : "CONTESTS"}</span></div>
    <section className="approval-panel contest-panel"><div className="panel-heading contest-panel-heading"><div><span className="eyebrow">OPEN CONTESTS</span><h2>Program contests</h2><p>Your participation is saved to your approved member account.</p></div><ProgramFilterDropdown id="member-contest-program-filter" programs={programs} value={selectedProgramId} className="contest-member-filter" onChange={(programId) => { setSelectedProgramId(programId); setSelectedContestId(""); }} /></div>
      <div className="approval-table-wrap"><table className="approval-table contest-table"><thead><tr><th>CONTEST DATE/TIME</th><th>CONTEST</th><th>JOIN</th><th>MECHANICS</th></tr></thead><tbody>
        {displayedContests.map((contest) => {
          const joined = joinedContestIds.includes(contest.id);
          const qualified = joinedContestStatuses[contest.id] === "Qualified Contestant";
          return <tr key={contest.id}><td><strong className="table-primary">{contest.contestDate ? displayDate(contest.contestDate) : "Date to be announced"}</strong><small className="table-muted">{contest.timeStart ? formatTimeValue(contest.timeStart) : "Time to be announced"}</small></td><td><strong className="table-primary">{contest.contest}</strong></td><td><button className={`contest-join${joined ? " contest-join--joined" : ""}${qualified ? " contest-join--qualified" : ""}`} disabled={joined || joiningContestId === contest.id} onClick={() => onJoin(contest)}>{joined ? <><Check size={14} />{qualified ? "Qualified Contestant" : "Joined"}</> : joiningContestId === contest.id ? "Joining…" : "Join"}</button></td><td><button className="contest-view" aria-expanded={selectedContestId === contest.id} onClick={() => setSelectedContestId((current) => current === contest.id ? "" : contest.id)}>{selectedContestId === contest.id ? "Hide mechanics" : "View mechanics"}<ArrowUpRight size={14} /></button></td></tr>;
        })}
        {!displayedContests.length && <tr><td colSpan={4} className="empty-table"><CalendarDays size={20} /><strong>{loading ? "Loading contests…" : selectedProgramId ? "No contests for this program yet" : "No contests have been published yet"}</strong><span>{loading ? "Program contests will appear here." : selectedProgramId ? "Choose another program or check back when a contest is announced." : "Check back when a program contest is announced."}</span></td></tr>}
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
    <div className="contest-schedule-fields"><Field label="Contest Date"><input type="date" name="contestDate" defaultValue={initialMechanics?.contestDate ?? ""} required /></Field><Field label="Time Start"><input type="time" name="timeStart" defaultValue={initialMechanics?.timeStart ?? ""} required /></Field></div>
    <input type="hidden" name="criteriaRows" value={JSON.stringify(criteriaRows)} readOnly />
    <div className="criteria-editor-heading"><span>CRITERIA & SCORING</span><button type="button" className="text-action" onClick={() => setCriteriaRows((current) => [...current, { criteria: "", description: "", weight: "" }])}><Plus size={15} /> Add Another Criteria</button></div>
    <div className="criteria-editor-list">{criteriaRows.map((row, index) => <div className="criteria-editor-row" key={index}><span className="criteria-editor-number">{String(index + 1).padStart(2, "0")}</span><label><span>Criteria</span><input aria-label={`Criteria ${index + 1}`} value={row.criteria} onChange={(event) => updateCriteria(index, "criteria", event.target.value)} placeholder="e.g. Innovation and relevance" required /></label><label><span>Description</span><textarea aria-label={`Description for criteria ${index + 1}`} value={row.description} onChange={(event) => updateCriteria(index, "description", event.target.value)} placeholder="Describe what judges should look for" rows={2} required /></label><label><span>Weight (%)</span><input aria-label={`Weight for criteria ${index + 1}`} type="number" min="0" step="0.01" value={row.weight} onChange={(event) => updateCriteria(index, "weight", event.target.value)} placeholder="e.g. 25" required /></label><button type="button" className="criteria-remove" disabled={criteriaRows.length === 1} aria-label={`Remove criteria ${index + 1}`} onClick={() => setCriteriaRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button></div>)}</div>
    {programs.length === 0 && <p className="form-hint">Publish a program before adding its contest mechanics.</p>}
    <div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" disabled={programs.length === 0} className="button button--olive">{initialMechanics ? "Save changes" : "Save mechanics"} <ArrowRight size={16} /></button></div>
  </form></div></div>;
}

function MaterialsPage({ materials, programs, isAdmin, isRegularMember, onAdd, onDownload, loading }: { materials: Material[]; programs: Program[]; isAdmin: boolean; isRegularMember: boolean; onAdd: () => void; onDownload: (material: Material) => void; loading: boolean }) {
  const [category, setCategory] = useState<MaterialCategory>("Presentation");
  const [program, setProgram] = useState("All programs");
  const [queryText, setQueryText] = useState("");
  const [dailyIndex, setDailyIndex] = useState(0);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(() => new Set());
  const availableMaterials = isAdmin ? materials : materials.filter((material) => material.enabled !== false);
  const dailyOptions = useMemo(() => {
    const selectedPrograms = program === "All programs" ? programs : programs.filter((item) => item.id === program);
    return Array.from(new Set(selectedPrograms.flatMap((item) => dateOptionsBetween(item.dateFrom, item.dateTo)))).sort();
  }, [program, programs]);
  const selectedDailyIndex = dailyOptions.length ? Math.min(dailyIndex, dailyOptions.length - 1) : 0;
  const selectedDailyDate = dailyOptions[selectedDailyIndex] ?? "";
  const dailyWindowStart = Math.min(Math.max(0, selectedDailyIndex - 1), Math.max(0, dailyOptions.length - 3));
  const visibleDayTabs = dailyOptions.slice(dailyWindowStart, dailyWindowStart + 3).map((date) => ({ date, index: dailyOptions.indexOf(date) }));
  const displayed = availableMaterials.filter((material) =>
    material.category === category
    && (program === "All programs" || material.programId === program)
    && (!queryText || `${material.name} ${material.programTitle} ${material.topic ?? ""}`.toLowerCase().includes(queryText.toLowerCase()))
  );
  const presentationMaterials = displayed.filter((material) => material.category === "Presentation");
  const dailyPresentationMaterials = isRegularMember && category === "Presentation" && selectedDailyDate
    ? presentationMaterials.filter((material) => programs.find((item) => item.id === material.programId)?.keynoteTopics?.some((item) => item.date === selectedDailyDate && item.topic.trim() === material.topic?.trim()) ?? false)
    : presentationMaterials;
  const presentationTopicGroups = Array.from(new Set(dailyPresentationMaterials.map((material) => material.topic?.trim() || "Other presentations"))).map((topic) => ({
    topic,
    materials: dailyPresentationMaterials.filter((material) => (material.topic?.trim() || "Other presentations") === topic),
  }));
  const colorByCategory: Record<string, string> = { Guidelines: "resource-green", Presentation: "resource-yellow", References: "resource-blue", Worksheet: "resource-orange", "Program Flow": "resource-blue", "Communication Letter": "resource-orange" };
  const isPresentationMemberView = isRegularMember && category === "Presentation";

  return <div className="content-wrap materials-page">

    <div className="resource-toolbar">
      <label className="search-box"><Search size={16} /><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Search materials" aria-label="Search materials" /></label>
      <label className="filter-select"><Filter size={14} /><select value={program} onChange={(event) => { setProgram(event.target.value); setDailyIndex(0); }} aria-label="Filter by program"><option>All programs</option>{programs.map((item) => <option key={item.id} value={item.id}>{item.eventTitle}</option>)}</select><ChevronDown size={13} /></label>
      {isAdmin && <button className="button button--olive" onClick={onAdd}><Plus size={16} /> Add material</button>}
    </div>
    <div className="resource-categories">{resourceCategoryOrder.map((item) => <button key={item} className={category === item ? "category-tab category-tab--active" : "category-tab"} onClick={() => { setCategory(item); if (item === "Presentation") setDailyIndex(0); }}>{item}<span>{availableMaterials.filter((material) => material.category === item).length}</span></button>)}</div>
    {isPresentationMemberView && <div className="presentation-daily-filter-wrap"><span className="presentation-daily-filter-label">Daily Filter</span><div className="day-controls presentation-day-controls"><button type="button" className="day-arrow" aria-label="Previous day" disabled={selectedDailyIndex === 0} onClick={() => setDailyIndex((current) => Math.max(0, Math.min(current, dailyOptions.length - 1) - 1))}><ChevronLeft size={19} /></button><div className="day-tabs presentation-day-tabs">{visibleDayTabs.map(({ date, index }) => <button type="button" key={date} className={`day-tab presentation-day-tab${selectedDailyIndex === index ? " day-tab--active" : ""}`} aria-pressed={selectedDailyIndex === index} onClick={() => setDailyIndex(index)}><span>DAY {String(index + 1).padStart(2, "0")}</span><small>{displayDate(date, { month: "short", day: "numeric" })}</small></button>)}</div><button type="button" className="day-arrow" aria-label="Next day" disabled={selectedDailyIndex >= dailyOptions.length - 1} onClick={() => setDailyIndex((current) => Math.min(dailyOptions.length - 1, current + 1))}><ChevronRight size={19} /></button></div></div>}
    {isPresentationMemberView ? <section className="presentation-topic-library" aria-label="Presentation topics">
      <div className="presentation-topics-heading"><span className="eyebrow">TOPIC</span><p>Choose a topic to view and download its materials.</p></div>
      <div className="presentation-topic-list">
        {presentationTopicGroups.map((group) => {
          const expanded = expandedTopics.has(group.topic);
          return <section className="presentation-topic-group" key={group.topic}>
            <button type="button" className="presentation-topic-toggle" aria-expanded={expanded} onClick={() => setExpandedTopics((current) => {
              const next = new Set(current);
              if (next.has(group.topic)) next.delete(group.topic);
              else next.add(group.topic);
              return next;
            })}>
              <span className="presentation-topic-title"><strong>{group.topic}</strong></span>
              <span className="presentation-topic-count">{group.materials.length} {group.materials.length === 1 ? "material" : "materials"}</span>
              <ChevronDown size={18} className={expanded ? "presentation-topic-chevron presentation-topic-chevron--open" : "presentation-topic-chevron"} />
            </button>
            {expanded && <div className="presentation-topic-materials">{group.materials.map((material) => <article className="presentation-material-row" key={material.id}>
              <span className="presentation-material-icon"><FileText size={17} /></span>
              <span className="presentation-material-info"><strong>{material.name}</strong><small>{material.programTitle}</small></span>
              <button type="button" className="presentation-download-button" onClick={() => onDownload(material)}><Download size={15} /> Download</button>
            </article>)}</div>}
          </section>;
        })}
        {!presentationTopicGroups.length && <div className="resource-empty"><div><FileCheck2 size={23} /></div><span className="eyebrow">PRESENTATIONS</span><h2>{loading ? "Gathering presentations…" : selectedDailyDate ? "No presentations for this day." : "No presentations are available yet."}</h2><p>{loading ? "Topic materials will appear here." : "When a presentation is shared for this topic or day, you’ll find it here."}</p></div>}
      </div>
    </section> : <div className="resource-grid">{displayed.map((material, index) => <article className={`resource-card ${colorByCategory[material.category] || ""}`} key={material.id} style={{ animationDelay: `${index * 50}ms` }}><div className="resource-card-top"><span className="resource-icon"><FileText size={20} /></span><span className="resource-category">{material.category}</span></div><h3>{material.name}</h3><p>{material.programTitle}</p><div className="resource-card-foot"><span><span className="online-dot" />{isAdmin && material.enabled === false ? "Hidden from regular users" : "Available to all members"}</span><button type="button" onClick={() => onDownload(material)} aria-label={`Download ${material.name}`} title={`Download ${material.name}`}><Download size={17} /></button></div></article>)}
      {!displayed.length && <div className="resource-empty"><div><FileCheck2 size={23} /></div><span className="eyebrow">A LITTLE ROOM TO GROW</span><h2>{loading ? "Gathering your materials…" : "The shelf is ready."}</h2><p>{loading ? "Shared resources will appear here." : "When a program resource is shared, you’ll find it here organized by type."}</p>{isAdmin && <button className="button button--olive" onClick={onAdd}><Plus size={16} /> Add the first material</button>}</div>}
    </div>}
  </div>;
}
function MaterialsTeaser({ materials, onOpen, onDownload }: { materials: Material[]; onOpen: () => void; onDownload: (material: Material) => void }) {
  return <section className="content-wrap materials-teaser"><div className="teaser-copy"><span className="eyebrow">TAKE IT WITH YOU</span><h2>Good ideas are<br /><i>meant to be shared.</i></h2><p>Find program flows, communication letters, guides, and other materials shared by the community.</p><button className="text-action" onClick={onOpen}>Visit the resource shelf <ArrowRight size={16} /></button></div><div className="teaser-shelf"><div className="shelf-top"><span>THE SHARED SHELF</span><span>{String(materials.length).padStart(2, "0")} ITEMS <ArrowUpRight size={13} /></span></div><div className="shelf-items">{materials.length ? materials.slice(0, 3).map((item, index) => <div className={`shelf-item shelf-item--${index}`} key={item.id}><span className="shelf-file-icon"><FileText size={16} /></span><span><strong>{item.name}</strong><small>{item.category}</small></span><button className="shelf-open" type="button" onClick={() => onDownload(item)} aria-label={`Download ${item.name}`} title={`Download ${item.name}`}><Download size={15} /></button></div>) : <div className="shelf-empty"><FileText size={18} /><span>No materials have been added yet.</span></div>}</div><div className="shelf-bottom"><span><span className="online-dot" /> Shared resources</span><span>CARAGA REGION XIII</span></div></div></section>;
}

function ProgramModal({ initialProgram, programs, onClose, onCreate }: { initialProgram: Program | null; programs: Program[]; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void }) {
  const [sessions, setSessions] = useState<ProgramSession[]>(() => initialProgram?.flow?.length ? initialProgram.flow.map(normalizeProgramSession) : [{ date: "", startTime: "", endTime: "", session: "", allParticipants: false, responsibleNotApplicable: false, responsible: [emptyResponsiblePerson()] }]);
  const [eventDateFrom, setEventDateFrom] = useState(initialProgram?.dateFrom ?? "");
  const [eventDateTo, setEventDateTo] = useState(initialProgram?.dateTo ?? "");
  const [keynoteTopics, setKeynoteTopics] = useState<ProgramKeynoteTopic[]>(() => initialProgram?.keynoteTopics?.length ? initialProgram.keynoteTopics.map((item) => ({ ...item })) : [{ date: "", session: "", topic: "" }]);
  const keynoteDateOptions = useMemo(() => dateOptionsBetween(eventDateFrom, eventDateTo), [eventDateFrom, eventDateTo]);
  const savedTopicOptions = useMemo(() => Array.from(new Set([
    ...programs.flatMap((program) => program.keynoteTopics?.map((item) => item.topic.trim()).filter(Boolean) ?? []),
    ...keynoteTopics.map((item) => item.topic.trim()).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b)), [keynoteTopics, programs]);

  const updateSession = (index: number, updates: Partial<ProgramSession>) => setSessions((current) => current.map((session, i) => i === index ? { ...session, ...updates } : session));
  const updateSessionTopic = (sessionIndex: number, topicIndex: number, value: string) => setSessions((current) => current.map((session, i) => {
    if (i !== sessionIndex) return session;
    const topics = session.topics?.length ? session.topics : [""];
    return { ...session, topics: topics.map((topic, j) => j === topicIndex ? value : topic) };
  }));
  const addSessionTopic = (sessionIndex: number) => setSessions((current) => current.map((session, i) => i === sessionIndex ? { ...session, topics: [...(session.topics?.length ? session.topics : [""]), ""] } : session));
  const removeSessionTopic = (sessionIndex: number, topicIndex: number) => setSessions((current) => current.map((session, i) => i === sessionIndex ? { ...session, topics: (session.topics?.length ? session.topics : [""]).filter((_, j) => j !== topicIndex) } : session));
  const updateResponsible = (sessionIndex: number, personIndex: number, field: keyof ResponsiblePerson, value: string) => setSessions((current) => current.map((session, i) => {
    if (i !== sessionIndex) return session;
    const people = responsiblePeople(session.responsible);
    return { ...session, responsible: people.map((person, j) => j === personIndex ? { ...person, [field]: value } : person) };
  }));
  const addSession = () => setSessions((current) => [...current, { date: current[0]?.date || "", startTime: "", endTime: "", session: "", allParticipants: false, responsibleNotApplicable: false, responsible: [emptyResponsiblePerson()] }]);
  const addResponsible = (sessionIndex: number) => setSessions((current) => current.map((session, i) => i === sessionIndex ? { ...session, responsible: [...responsiblePeople(session.responsible), emptyResponsiblePerson()] } : session));
  const removeResponsible = (sessionIndex: number, personIndex: number) => setSessions((current) => current.map((session, i) => i === sessionIndex ? { ...session, responsible: responsiblePeople(session.responsible).filter((_, j) => j !== personIndex) } : session));
  const updateKeynoteTopic = (index: number, updates: Partial<ProgramKeynoteTopic>) => setKeynoteTopics((current) => current.map((item, i) => i === index ? { ...item, ...updates } : item));
  const syncKeynoteDates = (from: string, to: string) => {
    const availableDates = dateOptionsBetween(from, to);
    if (availableDates.length) {
      setKeynoteTopics((current) => current.map((item) => ({ ...item, date: item.date ? (availableDates.includes(item.date) ? item.date : availableDates[0]) : "" })));
    }
  };
  const addKeynoteTopic = () => setKeynoteTopics((current) => [...current, { date: keynoteDateOptions[0] ?? "", session: "", topic: "" }]);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="form-modal program-editor" role="dialog" aria-modal="true" aria-label={initialProgram ? "Edit program" : "Create a program"}>
      <div className="form-modal-head">
        <div><span className="eyebrow">PROGRAM EDITOR</span><h2>{initialProgram ? "Update program" : "Build a program"}<span>.</span></h2><p>Set the event details and add the first sessions to the daily flow.</p></div>
        <button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button>
      </div>
      <form autoComplete="off" onSubmit={(event) => {
        event.preventDefault();
        const target = event.currentTarget;
        const flow = target.querySelector<HTMLInputElement>("[name=flowJson]");
        const topics = target.querySelector<HTMLInputElement>("[name=keynoteTopicsJson]");
        if (flow) flow.value = JSON.stringify(sessions);
        if (topics) topics.value = JSON.stringify(keynoteTopics);
        onCreate(event);
      }}>
        <input type="hidden" name="flowJson" value={JSON.stringify(sessions)} readOnly />
        <input type="hidden" name="keynoteTopicsJson" value={JSON.stringify(keynoteTopics)} readOnly />
        <div className="editor-grid">
          <Field label="Event title"><input autoComplete="off" name="eventTitle" defaultValue={initialProgram?.eventTitle ?? ""} placeholder="e.g. Regional learning exchange" required /></Field>
          <Field label="Theme"><input autoComplete="off" name="theme" defaultValue={initialProgram?.theme ?? ""} placeholder="e.g. Sustainable agriculture, thriving communities" required /></Field>
          <Field label="Venue"><input autoComplete="off" name="venue" defaultValue={initialProgram?.venue ?? ""} placeholder="City, venue, or online" required /></Field>
          <Field label="Date from"><input autoComplete="off" type="date" name="dateFrom" value={eventDateFrom} onChange={(event) => {
            const value = event.target.value;
            setEventDateFrom(value);
            syncKeynoteDates(value, eventDateTo);
            if (!sessions[0]?.date) updateSession(0, { date: value });
          }} required /></Field>
          <Field label="Date to"><input autoComplete="off" type="date" name="dateTo" value={eventDateTo} onChange={(event) => {
            const value = event.target.value;
            setEventDateTo(value);
            syncKeynoteDates(eventDateFrom, value);
          }} required /></Field>
          <Field label="Short description"><input autoComplete="off" name="description" defaultValue={initialProgram?.description ?? ""} placeholder="A short note for participants" /></Field>
        </div>
        <section className="editor-keynote-topics" aria-label="Keynote sessions and topics">
          <div className="editor-keynote-head">
            <div><span className="eyebrow">KEYNOTE SESSIONS &amp; TOPICS</span><p>Assign a topic to a keynote session date.</p></div>
            <button type="button" className="text-action" onClick={addKeynoteTopic}><Plus size={15} /> Add</button>
          </div>
          <div className="editor-keynote-topic-list">
            {keynoteTopics.map((item, index) => <div className="editor-keynote-topic-row" key={index}>
              <span className="editor-keynote-topic-num">{String(index + 1).padStart(2, "0")}</span>
              <label className="session-edit-field"><span>Date</span><select aria-label={`Keynote topic date ${index + 1}`} value={item.date} onChange={(event) => updateKeynoteTopic(index, { date: event.target.value })}>
                <option value="">Select a date</option>{keynoteDateOptions.map((date) => <option key={date} value={date}>{displayDate(date)}</option>)}
              </select></label>
              <label className="session-edit-field"><span>Keynote Session</span><select aria-label={`Keynote session ${index + 1}`} value={item.session} onChange={(event) => updateKeynoteTopic(index, { session: event.target.value })}>
                <option value="">Select a keynote session</option>{keynoteSessionOptions.map((session) => <option key={session} value={session}>{session}</option>)}
              </select></label>
              <label className="session-edit-field"><span>Topic</span><input autoComplete="off" aria-label={`Topic ${index + 1}`} placeholder="Enter the keynote topic" value={item.topic} onChange={(event) => updateKeynoteTopic(index, { topic: event.target.value })} /></label>
              <button type="button" aria-label={`Remove keynote topic ${index + 1}`} className="remove-session" disabled={keynoteTopics.length === 1} onClick={() => setKeynoteTopics((current) => current.filter((_, i) => i !== index))}><X size={15} /></button>
            </div>)}
          </div>
        </section>
        <div className="editor-session-head"><div><span className="eyebrow">DAILY PROGRAM FLOW</span><p>Each session has its own date, start and end time, and responsible people.</p></div><button type="button" className="text-action" onClick={addSession}><Plus size={15} /> Add a session</button></div>
        <div className="session-edit-list">{sessions.map((item, index) => <section className="session-edit-row" key={index} aria-label={`Session ${index + 1}`}>
          <div className="session-edit-main"><span className="session-edit-num">{String(index + 1).padStart(2, "0")}</span>
            <label className="session-edit-field session-edit-field--date"><span>Session date</span><input autoComplete="off" type="date" value={item.date} onChange={(event) => updateSession(index, { date: event.target.value })} required /></label>
            <label className="session-edit-field session-edit-field--start"><span>Start time</span><input autoComplete="off" lang="en-US" type="time" aria-label="Start time (HH:MM AM/PM)" value={sessionTimeRange(item).startTime} onChange={(event) => updateSession(index, { startTime: event.target.value })} required /></label>
            <label className="session-edit-field session-edit-field--end"><span>End time</span><input autoComplete="off" lang="en-US" type="time" aria-label="End time (HH:MM AM/PM)" value={sessionTimeRange(item).endTime} onChange={(event) => updateSession(index, { endTime: event.target.value })} required /></label>
            <label className="session-edit-field session-edit-field--title"><span>Session title</span><input autoComplete="off" placeholder="e.g. Opening ceremony" value={item.session} onChange={(event) => updateSession(index, { session: event.target.value })} required /></label>
            <button type="button" aria-label="Remove session" className="remove-session" disabled={sessions.length === 1} onClick={() => setSessions((current) => current.filter((_, i) => i !== index))}><X size={15} /></button>
          </div>
          <div className="session-edit-topics">
            <div className="session-edit-topics-head"><span>Topics</span><button type="button" className="text-action" onClick={() => addSessionTopic(index)}><Plus size={13} /> Add topic</button></div>
            <div className="session-edit-topic-list">{(item.topics?.length ? item.topics : [""]).map((topic, topicIndex) => <div className="session-edit-topic-row" key={topicIndex}>
              <label className="session-edit-field"><span>Topic</span><select aria-label={`Topic ${topicIndex + 1} for session ${index + 1}`} value={topic} onChange={(event) => updateSessionTopic(index, topicIndex, event.target.value)}>
                <option value="">Select a saved topic</option>
                {topic && !savedTopicOptions.includes(topic) && <option value={topic}>{topic}</option>}
                {savedTopicOptions.map((savedTopic) => <option key={savedTopic} value={savedTopic}>{savedTopic}</option>)}
              </select></label>
              <button type="button" className="remove-session" aria-label={`Remove topic ${topicIndex + 1} from session ${index + 1}`} disabled={(item.topics?.length ?? 0) <= 1} onClick={() => removeSessionTopic(index, topicIndex)}><X size={14} /></button>
            </div>)}</div>
          </div>
          <div className="session-edit-responsibles"><div className="session-edit-responsibles-head"><span>Responsible people</span><button type="button" className="text-action" disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onClick={() => addResponsible(index)}><Plus size={13} /> Add responsible</button></div>
            {responsiblePeople(item.responsible).map((person, personIndex) => <div className="responsible-edit-row" key={personIndex}>
              <input autoComplete="off" aria-label="Responsible name" placeholder="Responsible" value={person.name} disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onChange={(event) => updateResponsible(index, personIndex, "name", event.target.value)} />
              <input autoComplete="off" aria-label="Responsible designation" placeholder="Designation" value={person.designation} disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onChange={(event) => updateResponsible(index, personIndex, "designation", event.target.value)} />
              <input autoComplete="off" aria-label="Responsible office" placeholder="Office" value={person.office} disabled={Boolean(item.allParticipants || item.responsibleNotApplicable)} onChange={(event) => updateResponsible(index, personIndex, "office", event.target.value)} />
              <span className="all-participants-slot">{personIndex === 0 ? <span className="responsible-options">
                <label className="all-participants-toggle"><input type="checkbox" aria-label="All Participants" checked={Boolean(item.allParticipants)} onChange={(event) => updateSession(index, { allParticipants: event.target.checked, responsibleNotApplicable: false })} /><span>All Participants</span></label>
                <label className="all-participants-toggle"><input type="checkbox" aria-label="Responsible Not Applicable" checked={Boolean(item.responsibleNotApplicable)} onChange={(event) => updateSession(index, { responsibleNotApplicable: event.target.checked, allParticipants: false })} /><span>Responsible Not Applicable</span></label>
              </span> : null}</span>
              <button type="button" aria-label={`Remove responsible person ${personIndex + 1}`} className="remove-session" disabled={Boolean(item.allParticipants || item.responsibleNotApplicable) || responsiblePeople(item.responsible).length <= 1} onClick={() => removeResponsible(index, personIndex)}><X size={14} /></button>
            </div>)}
          </div>
        </section>)}</div>
        <div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" className="button button--olive">{initialProgram ? "Save changes" : "Publish program"} <ArrowRight size={16} /></button></div>
      </form>
    </div>
  </div>;
}
function MaterialModal({ programs, initialMaterial, onClose, onCreate, busy }: { programs: Program[]; initialMaterial: Material | null; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const [selectedFileName, setSelectedFileName] = useState("");
  const [resourceUrl, setResourceUrl] = useState(initialMaterial?.url ?? "");
  const [resourceError, setResourceError] = useState("");
  const [category, setCategory] = useState<MaterialCategory>(initialMaterial?.category ?? "Guidelines");
  const [topic, setTopic] = useState(initialMaterial?.topic ?? "");
  const savedTopics = useMemo(() => Array.from(new Set(programs.flatMap((program) => program.keynoteTopics?.map((item) => item.topic.trim()).filter(Boolean) ?? []))).sort((a, b) => a.localeCompare(b)), [programs]);

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

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="form-modal material-editor" role="dialog" aria-modal="true" aria-label={initialMaterial ? "Edit a material" : "Add a material"}>
      <div className="form-modal-head"><div><span className="eyebrow">RESOURCE LIBRARY</span><h2>{initialMaterial ? "Edit a material" : "Add a material"}<span>.</span></h2><p>Link a resource or upload a file for a published program.</p></div><button className="modal-close modal-close--inline" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
      <form onSubmit={handleSubmit}>
        <Field label="Program"><select name="programId" required defaultValue={initialMaterial?.programId ?? ""}><option value="" disabled>Select a published program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle} · {dateRange(program.dateFrom, program.dateTo)} · {program.venue}</option>)}</select></Field>
        <Field label="Category"><select name="category" value={category} onChange={(event) => setCategory(event.target.value as MaterialCategory)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></Field>
        {category === "Presentation" && <Field label="Topic"><select name="topic" value={topic} onChange={(event) => setTopic(event.target.value)}>
          <option value="">{savedTopics.length ? "Select a saved topic" : "No saved topics available"}</option>
          {topic && !savedTopics.includes(topic) && <option value={topic}>{topic}</option>}
          {savedTopics.map((savedTopic) => <option key={savedTopic} value={savedTopic}>{savedTopic}</option>)}
        </select></Field>}
        <Field label="Material name"><input name="materialName" defaultValue={initialMaterial?.name ?? ""} placeholder="e.g. Participant guide" /></Field>
        <label className="field"><span className="field-label">Upload a file</span><span className="file-picker"><Upload size={18} /><span><strong>{selectedFileName || "Choose a file"}</strong><small>{selectedFileName ? "Selected for upload" : "PDF, presentation, worksheet, or document · up to 16 MB"}</small></span><input type="file" name="materialFile" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" onChange={(event) => { setSelectedFileName(event.target.files?.[0]?.name ?? ""); setResourceError(""); }} /></span></label>
        <div className="or-divider"><span>OR ADD A LINK</span></div>
        <Field label="Resource URL"><input type="url" name="materialUrl" value={resourceUrl} onChange={(event) => { setResourceUrl(event.target.value); setResourceError(""); }} placeholder="https://…" /></Field>
        <p className="form-hint">Add either a resource URL or an uploaded file. You can leave the other option empty.</p>
        {resourceError && <p className="material-form-error" role="alert">{resourceError}</p>}
        <p className="upload-note"><LockKeyhole size={13} /> Uploads are available to approved members. Public program materials can be viewed without signing in.</p>
        <div className="form-modal-actions"><button type="button" className="button button--soft" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || programs.length === 0} className="button button--olive">{busy ? "Uploading…" : initialMaterial ? "Save changes" : "Add material"}<ArrowRight size={16} /></button></div>
        {programs.length === 0 && <p className="form-hint">Publish a program before adding its materials.</p>}
      </form>
    </div>
  </div>;
}
function SpeakerModal({ programs, initialSpeaker, onClose, onSave, busy }: {
  programs: Program[];
  initialSpeaker: SpeakerProfileCard | null;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const [affiliations, setAffiliations] = useState<SpeakerAffiliation[]>(() => initialSpeaker?.affiliations?.length ? initialSpeaker.affiliations.map((item) => ({ ...item })) : [{ position: "", organization: "" }]);
  const [keynoteSessions, setKeynoteSessions] = useState<SpeakerKeynoteSession[]>(() => initialSpeaker?.keynoteSessions?.length ? initialSpeaker.keynoteSessions.map((item) => ({ ...item })) : [{ date: "", session: "" }]);
  const [topics, setTopics] = useState<string[]>(() => initialSpeaker?.topics?.length ? [...initialSpeaker.topics] : [""]);
  const [selectedImageName, setSelectedImageName] = useState("");

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="form-modal speaker-editor" role="dialog" aria-modal="true" aria-label={initialSpeaker ? "Edit a speaker profile" : "Add a speaker profile"}>
    <div className="form-modal-head"><div><span className="eyebrow">SPEAKER DIRECTORY</span><h2>{initialSpeaker ? "Edit speaker" : "Add a speaker"}<span>.</span></h2><p>Build a profile card for a published program.</p></div><button className="modal-close modal-close--inline" onClick={() => !busy && onClose()} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={onSave}>
      <div className="speaker-editor-grid">
        <Field label="Program"><select name="programId" required defaultValue={initialSpeaker?.programId ?? ""}><option value="" disabled>Select a saved program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle}</option>)}</select></Field>
        <label className="field speaker-image-field"><span className="field-label">Upload an image</span><span className="file-picker"><Upload size={18} /><span><strong>{selectedImageName || (initialSpeaker ? "Replace profile photo" : "Choose a profile photo")}</strong><small>{selectedImageName ? "Ready to upload" : "JPG, PNG, or WebP · up to 8 MB"}</small></span><input type="file" name="speakerImage" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSelectedImageName(event.target.files?.[0]?.name ?? "")} /></span>{initialSpeaker && !selectedImageName && <span className="speaker-image-current"><img src={initialSpeaker.imageUrl} alt="Current speaker profile" /><span>Current image is kept unless you choose a replacement.</span></span>}</label>
        <section className="speaker-editor-section speaker-keynote-section">
          <div className="speaker-editor-section-head"><div><span className="eyebrow">KEYNOTE SESSIONS</span><p>Add the date and keynote session for this speaker.</p></div><button type="button" className="text-action" onClick={() => setKeynoteSessions((current) => [...current, { date: "", session: "" }])}><Plus size={14} /> Add</button></div>
          <input type="hidden" name="keynoteSessionsJson" value={JSON.stringify(keynoteSessions)} readOnly />
          <div className="speaker-entry-list">{keynoteSessions.map((item, index) => <div className="speaker-entry-row speaker-keynote-row" key={index}><label className="field"><span className="field-label">Date</span><input aria-label={`Keynote date ${index + 1}`} type="date" value={item.date} onChange={(event) => setKeynoteSessions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, date: event.target.value } : row))} /></label><label className="field"><span className="field-label">Keynote Session</span><select aria-label={`Keynote session ${index + 1}`} value={item.session} onChange={(event) => setKeynoteSessions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, session: event.target.value } : row))}><option value="">Select a keynote session</option>{keynoteSessionOptions.map((session) => <option key={session} value={session}>{session}</option>)}</select></label><button type="button" className="remove-session" aria-label={`Remove keynote session ${index + 1}`} disabled={keynoteSessions.length === 1} onClick={() => setKeynoteSessions((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button></div>)}</div>
        </section>
        <div className="speaker-name-row"><Field label="Name"><input name="name" defaultValue={initialSpeaker?.name ?? ""} placeholder="Speaker name" autoComplete="name" required /></Field><Field label="Post Nominal"><input name="postNominal" defaultValue={initialSpeaker?.postNominal ?? ""} placeholder="e.g. PhD." /></Field></div>
        <Field label="Designation"><input name="designation" defaultValue={initialSpeaker?.designation ?? ""} placeholder="e.g. Regional Director" required /></Field>
        <Field label="Office"><input name="office" defaultValue={initialSpeaker?.office ?? ""} placeholder="e.g. DA-RFO XIII" required /></Field>
      </div>
      <input type="hidden" name="affiliationsJson" value={JSON.stringify(affiliations)} readOnly />
      <input type="hidden" name="topicsJson" value={JSON.stringify(topics)} readOnly />
      <section className="speaker-editor-section">
        <div className="speaker-editor-section-head"><div><span className="eyebrow">POSITIONS & ORGANIZATIONS</span><p>Add one or more professional affiliations.</p></div><button type="button" className="text-action" onClick={() => setAffiliations((current) => [...current, { position: "", organization: "" }])}><Plus size={14} /> Add</button></div>
        <div className="speaker-entry-list">{affiliations.map((item, index) => <div className="speaker-entry-row speaker-affiliation-row" key={index}><input aria-label={"Position " + (index + 1)} value={item.position} onChange={(event) => setAffiliations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, position: event.target.value } : row))} placeholder="Position" /><input aria-label={"Organization " + (index + 1)} value={item.organization} onChange={(event) => setAffiliations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, organization: event.target.value } : row))} placeholder="Organization" /><button type="button" className="remove-session" aria-label={"Remove position " + (index + 1)} disabled={affiliations.length === 1} onClick={() => setAffiliations((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button></div>)}</div>
      </section>
      <section className="speaker-editor-section">
        <div className="speaker-editor-section-head"><div><span className="eyebrow">TOPICS</span><p>Add the topics this speaker will cover.</p></div><button type="button" className="text-action" onClick={() => setTopics((current) => [...current, ""])}><Plus size={14} /> Add</button></div>
        <div className="speaker-entry-list">{topics.map((topic, index) => <div className="speaker-entry-row speaker-topic-row" key={index}><input aria-label={"Topic " + (index + 1)} value={topic} onChange={(event) => setTopics((current) => current.map((value, rowIndex) => rowIndex === index ? event.target.value : value))} placeholder="e.g. Climate-smart agriculture" /><button type="button" className="remove-session" aria-label={"Remove topic " + (index + 1)} disabled={topics.length === 1} onClick={() => setTopics((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button></div>)}</div>
      </section>
      <p className="upload-note"><LockKeyhole size={13} /> Speaker profiles are publicly visible. Only admins can create, edit, or remove them.</p>
      {programs.length === 0 && <p className="form-hint">Publish a program before adding its speakers.</p>}
      <div className="form-modal-actions"><button type="button" className="button button--soft" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || programs.length === 0} className="button button--olive">{busy ? "Uploading…" : initialSpeaker ? "Save changes" : "Publish speaker"}<ArrowRight size={16} /></button></div>
    </form>
  </div></div>;
}

function DeleteConfirmModal({ target, busy, onClose, onConfirm }: { target: DeleteTarget; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const title = target.kind === "mechanics" ? "contest mechanics" : target.kind === "speaker" ? "speaker profile" : target.kind;
  const detail = target.kind === "program"
    ? "This also removes its contest mechanics, linked materials, speakers, and contest join records."
    : target.kind === "mechanics"
      ? "Associated member join records will also be removed."
      : target.kind === "speaker" ? "This removes the profile from the speaker directory." : "This removes the material record from the resource library.";
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title"><span className="delete-modal-icon"><Trash2 size={20} /></span><span className="eyebrow">SUPERADMIN ACTION</span><h2 id="delete-modal-title">Delete {title}?</h2><p><strong>{target.label}</strong> will be permanently deleted. {detail}</p><div className="form-modal-actions"><button type="button" className="button button--soft" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button button--danger" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete"}<Trash2 size={15} /></button></div></div></div>;
}

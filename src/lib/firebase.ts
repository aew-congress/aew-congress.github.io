import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDobUat-4Nt7XkGyX40qeO7PtsQSI-fRW8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "aew-caraga.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "aew-caraga",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "aew-caraga.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "691732140415",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:691732140415:web:9fd34c306ecef7430d4a4a",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-W3XYPMQHTY",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const SUPERADMIN_EMAIL = (process.env.NEXT_PUBLIC_SUPERADMIN_EMAIL || "rjamescute2@gmail.com").toLowerCase();

export type AccountStatus = "Unverified" | "Pending" | "Approved" | "Disapproved";
export type UserRole = "superadmin" | "admin" | "regular";

export type UserProfile = {
  uid: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  birthdate: string;
  sexAtBirth: "Male" | "Female";
  contactNo: string;
  position: string;
  designation: string;
  office: string;
  email: string;
  /** Optional for records created before role management was added. */
  role?: UserRole;
  /** Optional judging assignment for approved members. */
  judge?: "Yes" | "No";
  /** False until the member verifies the address used at registration. */
  emailVerified?: boolean;
  status: AccountStatus;
  createdAt?: unknown;
};

export type ResponsiblePerson = { name: string; designation: string; office: string };
export type ProgramSession = {
  date: string;
  startTime?: string;
  endTime?: string;
  /** Legacy field retained so existing Firestore program documents remain readable. */
  time?: string;
  session: string;
  /** Optional topic tags attached to this daily-flow session. */
  topics?: string[];
  allParticipants?: boolean;
  responsibleNotApplicable?: boolean;
  responsible: ResponsiblePerson[] | string;
};
export type ProgramKeynoteTopic = { date: string; session: string; topic: string };
export type Program = {
  id: string;
  eventTitle: string;
  /** Optional for previously saved programs that predate theme support. */
  theme?: string;
  dateFrom: string;
  dateTo: string;
  venue: string;
  description?: string;
  /** Optional for programs saved before keynote topics were added. */
  keynoteTopics?: ProgramKeynoteTopic[];
  /** Controls whether regular members and guests can access the evaluation form. */
  evaluationRevealed?: boolean;
  flow: ProgramSession[];
};

export type ContestCriterion = { criteria: string; description: string; weight: number };
export type ContestTeam = { id: string; name: string };
export type ContestMechanics = {
  id: string;
  programId: string;
  eventTitle: string;
  dateFrom: string;
  dateTo: string;
  venue: string;
  contest: string;
  contestDate?: string;
  timeStart?: string;
  criteria: ContestCriterion[];
  /** Teams configured for judging this specific contest. */
  teams?: ContestTeam[];
  /** Controls whether verified admin accounts can view this contest's rankings. */
  rankingsRevealed?: boolean;
  /** Optional contest instructions and rules stored as sanitized rich-text HTML. */
  mechanicsHtml?: string;
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
};
export type ContestJoin = {
  id: string;
  contestId: string;
  programId: string;
  contest: string;
  uid: string;
  joinedAt?: unknown;
  status?: "Joined" | "Qualified Contestant";
};

export type ContestScoreTeam = {
  id: string;
  name: string;
  hidden: boolean;
  scores: Array<number | null>;
};
export type ContestScoreSheet = {
  contestId: string;
  judgeUid: string;
  teams: ContestScoreTeam[];
  updatedAt?: unknown;
};

export type AttendanceConfirmation = {
  id: string;
  programId: string;
  uid: string;
  confirmedAt?: unknown;
};

export type ProgramEvaluation = {
  id: string;
  programId: string;
  programTitle: string;
  respondentUid: string;
  respondentKind: "member" | "guest";
  name: string;
  clientType: string;
  beneficiaryType: string;
  beneficiaryCategory: string;
  beneficiaryOther: string;
  registrationId: string;
  contactNo: string;
  groupName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  region: string;
  province: string;
  cityMunicipality: string;
  barangay: string;
  street: string;
  sex: string;
  birthdate: string;
  membership: string;
  interventions: string[];
  interventionOtherQuantity: string;
  interventionOtherDetail: string;
  cc1: string;
  cc2: string;
  cc3: string;
  overallSatisfaction: string;
  qualityScores: string[];
  deliveryScore: string;
  suggestions: string;
  caDistributed: boolean;
  submittedAt?: unknown;
};

export type MaterialCategory = "Guidelines" | "Presentation" | "References" | "Worksheet" | "Program Flow" | "Communication Letter";
export type MaterialFile = { url: string; name: string; type?: string };
export type MaterialImage = { url: string; name: string };
export type Material = {
  id: string;
  programId: string;
  programTitle: string;
  category: MaterialCategory;
  /** Optional topic tag for presentation materials. */
  topic?: string;
  /** Program Flow session title; falls back to the legacy keynoteSession field on old records. */
  session?: string;
  /** @deprecated Retained to read existing material records. */
  keynoteSession?: string;
  /** Optional image attachments, used by program-flow materials. */
  images?: MaterialImage[];
  /** Optional list of uploaded files; older materials use `url` and `name`. */
  files?: MaterialFile[];
  name: string;
  url: string;
  enabled?: boolean;
  createdAt?: unknown;
};

export type SpeakerAffiliation = { position: string; organization: string };
export type SpeakerKeynoteSession = { date: string; session: string };
export type SpeakerProfileCard = {
  id: string;
  programId: string;
  imageUrl: string;
  imageKey: string;
  name: string;
  postNominal?: string;
  designation: string;
  office: string;
  affiliations: SpeakerAffiliation[];
  topics: string[];
  keynoteSessions?: SpeakerKeynoteSession[];
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
};

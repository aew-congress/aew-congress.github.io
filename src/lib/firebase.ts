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
  flow: ProgramSession[];
};

export type ContestCriterion = { criteria: string; description: string; weight: number };
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

export type AttendanceConfirmation = {
  id: string;
  programId: string;
  uid: string;
  confirmedAt?: unknown;
};

export type MaterialCategory = "Guidelines" | "Presentation" | "References" | "Worksheet" | "Program Flow" | "Communication Letter";
export type Material = {
  id: string;
  programId: string;
  programTitle: string;
  category: MaterialCategory;
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

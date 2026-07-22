/**
 * Default expertise tags for community discovery.
 * Seeded into master_data_items (type EXPERTISE); admins can extend via MDM.
 */
export type ExpertiseSeedItem = {
  label: string;
  code: string;
  aliases?: string[];
};

export const EXPERTISE_SEED_ITEMS: ExpertiseSeedItem[] = [
  { label: "Software Development", code: "SOFTWARE_DEV", aliases: ["software", "developer", "programming"] },
  { label: "React Native", code: "REACT_NATIVE", aliases: ["react native", "reactnative"] },
  { label: "Flutter", code: "FLUTTER" },
  { label: "Node.js", code: "NODEJS", aliases: ["node", "nodejs", "node js"] },
  { label: "AI", code: "AI", aliases: ["artificial intelligence"] },
  { label: "Machine Learning", code: "ML", aliases: ["machine learning", "ml"] },
  { label: "Doctor", code: "DOCTOR", aliases: ["medical", "physician", "mbbs"] },
  { label: "Medical Guidance", code: "MEDICAL_GUIDANCE", aliases: ["health guidance", "medical advice"] },
  { label: "Lawyer", code: "LAWYER", aliases: ["advocate", "legal"] },
  { label: "Civil Law", code: "CIVIL_LAW" },
  { label: "Property Law", code: "PROPERTY_LAW", aliases: ["property", "real estate law"] },
  { label: "GST", code: "GST", aliases: ["goods and services tax"] },
  { label: "Income Tax", code: "INCOME_TAX", aliases: ["tax", "itr"] },
  { label: "Export", code: "EXPORT", aliases: ["export business", "exports"] },
  { label: "Agriculture", code: "AGRICULTURE", aliases: ["farming", "farmer", "agri"] },
  { label: "Photography", code: "PHOTOGRAPHY", aliases: ["photographer"] },
  { label: "Teaching", code: "TEACHING", aliases: ["teacher", "tutor", "education"] },
  { label: "TNPSC", code: "TNPSC" },
  { label: "UPSC", code: "UPSC" },
  { label: "NEET", code: "NEET" },
  { label: "TRB", code: "TRB" },
  { label: "Bank Exams", code: "BANK_EXAMS", aliases: ["bank exam", "banking exam"] },
  { label: "Business", code: "BUSINESS" },
  { label: "Startup", code: "STARTUP", aliases: ["start up", "entrepreneur"] },
  { label: "Finance", code: "FINANCE", aliases: ["financial"] },
  { label: "Marketing", code: "MARKETING" },
  { label: "Design", code: "DESIGN", aliases: ["designer", "ui", "ux"] },
  { label: "Architecture", code: "ARCHITECTURE", aliases: ["architect"] },
  { label: "Civil Engineering", code: "CIVIL_ENGINEERING", aliases: ["civil engineer"] },
  { label: "Mechanical", code: "MECHANICAL", aliases: ["mechanical engineering"] },
  { label: "Electrical", code: "ELECTRICAL", aliases: ["electrical engineering"] },
  { label: "Government Services", code: "GOVT_SERVICES", aliases: ["government", "govt"] },
  { label: "Career Guidance", code: "CAREER_GUIDANCE", aliases: ["career", "mentorship", "mentor"] },
  { label: "Business Consulting", code: "BUSINESS_CONSULTING", aliases: ["consulting", "consultant"] },
  { label: "Legal Advice", code: "LEGAL_ADVICE" }
];

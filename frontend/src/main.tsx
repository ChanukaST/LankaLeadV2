import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  HelpCircle,
  Layers,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  PhoneCall,
  Radio,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
  Table,
  Target,
  Trophy,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import "./styles.css";

type Category = { id: string; name: string; slug: string };
type Location = { id: string; province: string; district: string; city: string };

type DiscoveryRun = {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  province?: string;
  district?: string;
  city?: string;
  category_id: string;
  source_provider?: string;
  max_records?: number;
  businesses_found: number;
  websites_checked: number;
  websites_found: number;
  websites_not_detected: number;
  error?: string;
  created_at: string;
};

type ProviderMetadata = {
  id: string;
  name: string;
  description: string;
  badge: string;
  is_healthy: boolean;
};

type Business = {
  id: string;
  name: string;
  category: string;
  city: string;
  district: string;
  province: string;
  phone?: string;
  email?: string;
  address?: string;
  website_status: string;
  website_url?: string;
  created_at?: string;
  primary_source?: string;
  discovery_evidence?: string;
  sources?: { name: string; external_id: string; source_url?: string; confidence?: number }[];
  social_profiles?: { platform: string; profile_url: string }[];
  outreach_status?: string;
  outreach_notes?: string;
  last_contacted_at?: string;
};

type LeadMetrics = {
  total_leads: number;
  prime_targets: number;
  social_only: number;
  no_website: number;
  pipeline_new: number;
  pipeline_contacted: number;
  pipeline_follow_up: number;
  pipeline_proposal: number;
  pipeline_won: number;
  pipeline_not_interested: number;
};

const OUTREACH_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  NEW: { label: "New Lead", color: "#475569", bg: "#f1f5f9", icon: "✨" },
  CONTACTED: { label: "Contacted", color: "#1d4ed8", bg: "#eff6ff", icon: "📞" },
  FOLLOW_UP: { label: "Follow-Up", color: "#b45309", bg: "#fef3c7", icon: "⏳" },
  PROPOSAL_SENT: { label: "Proposal Sent", color: "#7e22ce", bg: "#f3e8ff", icon: "📄" },
  WON: { label: "Deal Won 🎉", color: "#15803d", bg: "#dcfce7", icon: "🏆" },
  NOT_INTERESTED: { label: "Not Interested", color: "#b91c1c", bg: "#fee2e2", icon: "✖️" },
};

function getWhatsAppUrl(phone?: string, customText?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  let formatted = "";
  if (digits.startsWith("947") && digits.length === 11) {
    formatted = digits;
  } else if (digits.startsWith("07") && digits.length === 10) {
    formatted = `94${digits.slice(1)}`;
  } else if (digits.startsWith("7") && digits.length === 9) {
    formatted = `94${digits}`;
  } else if (digits.length >= 9) {
    formatted = digits;
  }
  if (!formatted) return null;
  const baseUrl = `https://wa.me/${formatted}`;
  return customText ? `${baseUrl}?text=${encodeURIComponent(customText)}` : baseUrl;
}

function generateColdPitch(biz: Business): { english: string; whatsapp: string } {
  const cat = biz.category || "business";
  const loc = [biz.city, biz.district].filter(Boolean).join(", ") || "Sri Lanka";

  const english = `Hello! Is this the manager or owner of ${biz.name}?

I was looking for ${cat} in ${loc} and came across your profile. You have great local visibility, but when customers search online, you don't have an official website or menu/services catalog yet.

We build modern, mobile-friendly websites specifically for Sri Lankan ${cat} businesses to help you capture direct orders, customer inquiries, and rank higher on Google Maps.

Would you be open to a quick 2-minute chat, or could I send you a 1-minute free preview over WhatsApp?`;

  const whatsapp = `Ayubowan / Hello ${biz.name} team! 🙏

I noticed that your business (${cat} in ${loc}) doesn't have an official website yet.

Today, over 80% of customers search on Google and social media before visiting or ordering. We build affordable, high-converting websites and Google Maps setups tailored for Sri Lankan businesses so you can receive direct customer inquiries, bookings, and payments.

Would you like to see a free quick mockup website we could create for ${biz.name}?

Looking forward to hearing from you!`;

  return { english, whatsapp };
}

const SRI_LANKA_PROVINCES = [
  "Central",
  "Eastern",
  "Northern",
  "North Central",
  "North Western",
  "Sabaragamuwa",
  "Southern",
  "Uva",
  "Western",
];

const getCategoryIcon = (categoryName?: string) => {
  if (!categoryName) return "🏷️";
  const norm = categoryName.toLowerCase();
  if (norm.includes("cafe") || norm.includes("coffee") || norm.includes("bakery")) return "☕";
  if (norm.includes("restaurant") || norm.includes("food") || norm.includes("dining")) return "🍽️";
  if (norm.includes("hotel") || norm.includes("resort") || norm.includes("lodge") || norm.includes("hostel")) return "🏨";
  if (norm.includes("gym") || norm.includes("fitness") || norm.includes("sport")) return "🏋️";
  if (norm.includes("salon") || norm.includes("hair") || norm.includes("beauty") || norm.includes("spa")) return "✂️";
  if (norm.includes("photo")) return "📷";
  if (norm.includes("travel") || norm.includes("tour")) return "✈️";
  if (norm.includes("garage") || norm.includes("auto") || norm.includes("repair")) return "🔧";
  return "🏷️";
};

type WebsiteCheckRecord = {
  final_url?: string;
  http_status?: number;
  response_time_ms?: number;
  https: boolean;
  title?: string;
  meta_description?: string;
  redirect_chain?: string[];
  has_robots_txt?: boolean;
  has_sitemap?: boolean;
  is_parked?: boolean;
  name_matched?: boolean;
  phone_matched?: boolean;
  confidence_score?: number;
  error?: string;
  checked_at: string;
};

type TimelineEvent = {
  event: string;
  label: string;
  title: string;
  detail: string;
  timestamp?: string;
  url?: string;
};

type BusinessDetail = Business & {
  sources: { name: string; external_id: string; source_url?: string; confidence: number }[];
  social_profiles: { platform: string; profile_url: string; discovered_at: string }[];
  website?: {
    url: string;
    status: string;
    last_checked_at?: string;
    checks: WebsiteCheckRecord[];
  };
  evidence: string[];
  timeline: TimelineEvent[];
};

type ProviderStatus = {
  provider_name: string;
  is_healthy: boolean;
  message: string;
  endpoints: string[];
  last_checked: string;
};

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const token = localStorage.getItem("lankalead_token");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: { message?: string } } | null;
    throw new Error(body?.detail?.message || `Request failed (${response.status})`);
  }
  return response.json();
};

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase().replace(/\s+/g, "_");
  let className = "badge-not-detected";
  let icon = <HelpCircle size={12} />;
  let label = status.replace(/_/g, " ");

  if (normalized === "WEBSITE_FOUND") {
    className = "badge-found";
    icon = <CheckCircle2 size={12} />;
    label = "Website Found";
  } else if (normalized === "WEBSITE_NOT_DETECTED") {
    className = "badge-not-detected";
    icon = <HelpCircle size={12} />;
    label = "Website Not Detected";
  } else if (normalized === "WEBSITE_UNCLEAR") {
    className = "badge-unclear";
    icon = <AlertCircle size={12} />;
    label = "Website Status Unclear";
  } else if (normalized === "WEBSITE_UNREACHABLE") {
    className = "badge-unreachable";
    icon = <XCircle size={12} />;
    label = "Website Unreachable";
  } else if (normalized === "WEBSITE_PARKED") {
    className = "badge-parked";
    icon = <AlertCircle size={12} />;
    label = "Website Parked";
  } else if (normalized === "SOCIAL_ONLY") {
    className = "badge-social-only";
    icon = <Globe size={12} />;
    label = "Social Presence Only";
  }

  return (
    <span className={`badge ${className}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

function OutreachBadge({
  status,
  onChange,
  disabled,
}: {
  status?: string;
  onChange?: (newStatus: string) => void;
  disabled?: boolean;
}) {
  const norm = (status || "NEW").toUpperCase();
  const cfg = OUTREACH_STATUS_CONFIG[norm] || OUTREACH_STATUS_CONFIG.NEW;

  if (!onChange) {
    return (
      <span
        className="badge"
        style={{
          background: cfg.bg,
          color: cfg.color,
          borderColor: cfg.color + "40",
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
      </span>
    );
  }

  return (
    <select
      className="outreach-select"
      value={norm}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value);
      }}
      style={{
        background: cfg.bg,
        color: cfg.color,
        borderColor: cfg.color + "60",
      }}
      title="Click to update sales pipeline status"
    >
      <option value="NEW">✨ New Lead</option>
      <option value="CONTACTED">📞 Contacted</option>
      <option value="FOLLOW_UP">⏳ Follow-Up</option>
      <option value="PROPOSAL_SENT">📄 Proposal Sent</option>
      <option value="WON">🏆 Won / Closed 🎉</option>
      <option value="NOT_INTERESTED">✖️ Not Interested</option>
    </select>
  );
}

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [providers, setProviders] = useState<ProviderMetadata[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("composite");
  const [maxRecords, setMaxRecords] = useState<number>(50);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessDetail | null>(null);
  const [inspectingDiscovery, setInspectingDiscovery] = useState<Business | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);

  // Outreach & Lead CRM state
  const [leadMetrics, setLeadMetrics] = useState<LeadMetrics | null>(null);
  const [quickSegment, setQuickSegment] = useState<"all" | "prime" | "social" | "pipeline" | "won" | "not_interested">("all");
  const [filterOutreachStatus, setFilterOutreachStatus] = useState("");
  const [filterPrimeLeads, setFilterPrimeLeads] = useState(false);
  const [filterSocialOnly, setFilterSocialOnly] = useState(false);

  // Outreach editing state in Modal
  const [notesDraft, setNotesDraft] = useState("");
  const [savingOutreach, setSavingOutreach] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
  const [copiedPitch, setCopiedPitch] = useState(false);
  const [pitchTab, setPitchTab] = useState<"whatsapp" | "call">("whatsapp");

  // Filters
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [filterProvince, setFilterProvince] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterRunId, setFilterRunId] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalItems, setTotalItems] = useState(0);

  // Category organization & View mode
  const [viewMode, setViewMode] = useState<"grouped" | "table">("grouped");
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of businesses) {
      const cat = b.category || "Uncategorized";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [businesses]);

  const sortedCategoryNames = useMemo(() => {
    return Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a]);
  }, [categoryCounts]);

  const groupedBusinesses = useMemo(() => {
    const groups: Record<string, Business[]> = {};
    for (const b of businesses) {
      const cat = b.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(b);
    }
    return groups;
  }, [businesses]);

  // UI state
  const [runMessage, setRunMessage] = useState("");
  const [startingDiscovery, setStartingDiscovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Sign in or create an account to start business discovery.");
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("lankalead_token")));

  // Handle URL hash routing (e.g. #/business/UUID)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/business\/([a-f0-9-]+)$/i);
      if (match && match[1]) {
        openBusiness(match[1]);
      } else if (!hash || hash === "#") {
        setSelectedBusiness(null);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    if (window.location.hash.startsWith("#/business/")) {
      handleHashChange();
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [authenticated]);

  // Initial data loading
  useEffect(() => {
    if (!authenticated) return;
    Promise.all([
      api<Category[]>("/categories"),
      api<Location[]>("/locations"),
      api<DiscoveryRun[]>("/discovery"),
      api<ProviderStatus>("/providers/status").catch(() => null),
      api<ProviderMetadata[]>("/collector/providers").catch(() => []),
    ])
      .then(([loadedCategories, loadedLocations, loadedRuns, provider, loadedProviders]) => {
        setCategories(loadedCategories);
        setLocations(loadedLocations);
        setRuns(loadedRuns);
        if (provider) setProviderStatus(provider);
        if (loadedProviders && loadedProviders.length > 0) setProviders(loadedProviders);
      })
      .catch(() => setMessage("Unable to load dashboard metadata."));
  }, [authenticated]);

  const authenticate = async () => {
    try {
      const result = await api<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("lankalead_token", result.access_token);
      setAuthenticated(true);
      setMessage("Welcome back.");
    } catch {
      setMessage("Login failed. Check your email or password.");
    }
  };

  const register = async () => {
    try {
      const result = await api<{ access_token: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("lankalead_token", result.access_token);
      setAuthenticated(true);
      setMessage("Account created.");
    } catch {
      setMessage("Registration failed. Use a valid email and 8+ character password.");
    }
  };

  const loadLeadMetrics = async () => {
    if (!authenticated) return;
    try {
      const data = await api<LeadMetrics>("/lead-metrics");
      setLeadMetrics(data);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    if (authenticated) {
      loadLeadMetrics();
    }
  }, [authenticated]);

  const loadBusinesses = async (pageToLoad: number = page) => {
    try {
      const params = new URLSearchParams({
        page: pageToLoad.toString(),
        page_size: pageSize.toString(),
        sort_by: sortBy,
        sort_order: sortOrder,
      });
      if (filterCategory) params.set("category_id", filterCategory);
      if (filterProvince) params.set("province", filterProvince);
      if (filterDistrict) params.set("district", filterDistrict);
      if (filterCity) params.set("city", filterCity);
      if (filterStatus) params.set("website_status", filterStatus);
      if (filterOutreachStatus) params.set("outreach_status", filterOutreachStatus);
      if (filterPrimeLeads) params.set("prime_leads", "true");
      if (filterSocialOnly) params.set("social_only", "true");
      if (filterRunId) params.set("run_id", filterRunId);
      if (filterSource) params.set("source_name", filterSource);
      if (search) params.set("search", search);

      const result = await api<{ data: Business[]; pagination: { total: number; page: number; page_size: number } }>(
        `/businesses?${params}`
      );
      setBusinesses(result.data);
      setTotalItems(result.pagination.total);
      setPage(pageToLoad);
    } catch {
      setMessage("Unable to load businesses.");
    }
  };

  useEffect(() => {
    if (authenticated) {
      loadBusinesses(1);
    }
  }, [authenticated, filterCategory, filterProvince, filterDistrict, filterCity, filterStatus, filterOutreachStatus, filterPrimeLeads, filterSocialOnly, filterRunId, filterSource, sortBy, sortOrder, pageSize]);

  const updateBusinessOutreach = async (businessId: string, status?: string, notes?: string) => {
    try {
      setSavingOutreach(true);
      const body: { outreach_status?: string; outreach_notes?: string } = {};
      if (status) body.outreach_status = status;
      if (notes !== undefined) body.outreach_notes = notes;

      const updated = await api<Business>(`/businesses/${businessId}/outreach`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      setBusinesses((prev) =>
        prev.map((b) =>
          b.id === businessId
            ? {
                ...b,
                outreach_status: updated.outreach_status,
                outreach_notes: updated.outreach_notes,
                last_contacted_at: updated.last_contacted_at,
              }
            : b
        )
      );

      if (selectedBusiness && selectedBusiness.id === businessId) {
        setSelectedBusiness((prev) =>
          prev
            ? {
                ...prev,
                outreach_status: updated.outreach_status,
                outreach_notes: updated.outreach_notes,
                last_contacted_at: updated.last_contacted_at,
              }
            : null
        );
        setSaveSuccessMessage("Saved!");
        setTimeout(() => setSaveSuccessMessage(""), 2500);
      }

      loadLeadMetrics();
      return updated;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update outreach");
      return null;
    } finally {
      setSavingOutreach(false);
    }
  };

  const selectQuickSegment = (segment: "all" | "prime" | "social" | "pipeline" | "won" | "not_interested") => {
    setQuickSegment(segment);
    if (segment === "all") {
      setFilterPrimeLeads(false);
      setFilterSocialOnly(false);
      setFilterStatus("");
      setFilterOutreachStatus("");
    } else if (segment === "prime") {
      setFilterPrimeLeads(true);
      setFilterSocialOnly(false);
      setFilterStatus("");
      setFilterOutreachStatus("");
    } else if (segment === "social") {
      setFilterPrimeLeads(false);
      setFilterSocialOnly(true);
      setFilterStatus("SOCIAL_ONLY");
      setFilterOutreachStatus("");
    } else if (segment === "pipeline") {
      setFilterPrimeLeads(false);
      setFilterSocialOnly(false);
      setFilterStatus("");
      setFilterOutreachStatus("CONTACTED");
    } else if (segment === "won") {
      setFilterPrimeLeads(false);
      setFilterSocialOnly(false);
      setFilterStatus("");
      setFilterOutreachStatus("WON");
    } else if (segment === "not_interested") {
      setFilterPrimeLeads(false);
      setFilterSocialOnly(false);
      setFilterStatus("");
      setFilterOutreachStatus("NOT_INTERESTED");
    }
  };

  const startDiscovery = async (override?: {
    locationId?: string;
    categoryId?: string;
    provider?: string;
    maxRecords?: number;
  }) => {
    setStartingDiscovery(true);
    const targetLoc = override?.locationId !== undefined ? override.locationId : locationId;
    const targetCat = override?.categoryId !== undefined ? override.categoryId : categoryId;
    const targetProvider = override?.provider || selectedProvider;
    const targetLimit = override?.maxRecords || maxRecords;

    let province: string | undefined = undefined;
    let district: string | undefined = undefined;
    let city: string | undefined = undefined;

    if (targetLoc.startsWith("province:")) {
      province = targetLoc.replace("province:", "");
    } else if (targetLoc) {
      const location = locations.find((item) => item.id === targetLoc);
      province = location?.province;
      district = location?.district;
      city = location?.city;
    }

    try {
      const run = await api<DiscoveryRun>("/collector/run", {
        method: "POST",
        body: JSON.stringify({
          category_id: targetCat && targetCat !== "all" ? targetCat : undefined,
          province,
          district,
          city,
          source_provider: targetProvider,
          max_records: targetLimit,
          sync_wait: false,
        }),
      });
      setRuns((current) => [run, ...current]);
      setRunMessage(
        `🚀 Scraper job launched [${run.id.slice(0, 8)}] using ${targetProvider.toUpperCase()} (${targetLimit} lead limit). Live results streaming below...`
      );
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : "Unable to start scraper run.");
    } finally {
      setStartingDiscovery(false);
    }
  };

  const applyPresetAndRun = (locVal: string, catVal: string, provVal: string, limitVal: number) => {
    setLocationId(locVal);
    setCategoryId(catVal);
    setSelectedProvider(provVal);
    setMaxRecords(limitVal);
    startDiscovery({ locationId: locVal, categoryId: catVal, provider: provVal, maxRecords: limitVal });
  };

  const cancelDiscovery = async (runId: string) => {
    try {
      const run = await api<DiscoveryRun>(`/discovery/${runId}/cancel`, { method: "POST" });
      setRuns((current) => current.map((item) => (item.id === run.id ? run : item)));
    } catch {
      setRunMessage("Unable to cancel discovery run.");
    }
  };

  // Poll active runs
  useEffect(() => {
    if (!authenticated || !runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING")) return;
    const timer = window.setInterval(async () => {
      const updated = await api<DiscoveryRun[]>("/discovery").catch(() => runs);
      setRuns(updated);
      if (updated.some((run) => run.status === "COMPLETED")) {
        loadBusinesses();
        loadLeadMetrics();
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [authenticated, runs]);

  const exportFiltered = async (format: "csv" | "json") => {
    const token = localStorage.getItem("lankalead_token");
    const params = new URLSearchParams();
    if (filterCategory) params.set("category_id", filterCategory);
    if (filterProvince) params.set("province", filterProvince);
    if (filterDistrict) params.set("district", filterDistrict);
    if (filterCity) params.set("city", filterCity);
    if (filterStatus) params.set("website_status", filterStatus);
    if (filterOutreachStatus) params.set("outreach_status", filterOutreachStatus);
    if (filterPrimeLeads) params.set("prime_leads", "true");
    if (filterSocialOnly) params.set("social_only", "true");
    if (filterRunId) params.set("run_id", filterRunId);
    if (filterSource) params.set("source_name", filterSource);
    if (search) params.set("search", search);

    const response = await fetch(`/api/exports/businesses.${format}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setMessage(`Unable to export businesses as ${format.toUpperCase()}.`);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = format === "csv" ? `lankalead-telesales-calling-sheet.csv` : `lankalead-businesses.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openBusiness = async (businessId: string) => {
    try {
      const data = await api<BusinessDetail>(`/businesses/${businessId}`);
      setSelectedBusiness(data);
      setNotesDraft(data.outreach_notes || "");
      setSaveSuccessMessage("");
      window.location.hash = `#/business/${businessId}`;
    } catch {
      setMessage("Unable to load business profile.");
    }
  };

  const closeBusiness = () => {
    setSelectedBusiness(null);
    window.location.hash = "#";
  };

  const resetFilters = () => {
    setSearch("");
    setFilterProvince("");
    setFilterDistrict("");
    setFilterCity("");
    setFilterCategory("");
    setFilterStatus("");
    setFilterOutreachStatus("");
    setFilterPrimeLeads(false);
    setFilterSocialOnly(false);
    setQuickSegment("all");
    setFilterRunId("");
    setFilterSource("");
    setSortBy("created_at");
    setSortOrder("desc");
  };

  if (!authenticated) {
    return (
      <main className="auth">
        <section className="auth-card">
          <p className="eyebrow">LANKALEAD</p>
          <h1>Understand the online presence of Sri Lankan businesses.</h1>
          <div className="auth-message">{message}</div>
          <div>
            <label>Email address</label>
            <input placeholder="name@company.lk" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label>Password (8+ chars)</label>
            <input placeholder="••••••••" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="actions">
            <button onClick={authenticate}>Sign in</button>
            <button className="secondary" onClick={register}>Create account</button>
          </div>
          <small>
            Evidence-based discovery. Absence of detected evidence does not prove a business has no website.
          </small>
        </section>
      </main>
    );
  }

  const renderBusinessTable = (items: Business[]) => (
    <table>
      <thead>
        <tr>
          <th>Business Name</th>
          <th>Category</th>
          <th>Location</th>
          <th>Contact & Direct Pitch</th>
          <th>Website Candidate</th>
          <th>Presence Status</th>
          <th>Found Via</th>
          <th>Sales Pipeline</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
              No business records match the current filters. Run a discovery or adjust search criteria.
            </td>
          </tr>
        ) : (
          items.map((biz) => {
            const hasValidWebsite = Boolean(
              biz.website_url &&
              biz.website_url.toLowerCase() !== "none" &&
              !biz.website_url.toLowerCase().includes("://none")
            );
            const locationParts = [biz.city, biz.district, biz.province]
              .map((p) => (p || "").trim())
              .filter((p) => p && p.toLowerCase() !== "none" && p.toLowerCase() !== "sri lanka");
            const locationDisplay = locationParts.length > 0 ? locationParts.join(", ") : (biz.province || "Sri Lanka");

            return (
              <tr key={biz.id}>
                <td>
                  <button className="link-button" onClick={() => openBusiness(biz.id)}>
                    {biz.name}
                  </button>
                </td>
                <td>
                  <span className="badge-category">
                    {getCategoryIcon(biz.category)} {biz.category}
                  </span>
                </td>
                <td>
                  <MapPin size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
                  {locationDisplay}
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {biz.phone ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <Phone size={12} style={{ color: "var(--primary)", flexShrink: 0 }} />
                        <a
                          href={`tel:${biz.phone}`}
                          style={{ color: "inherit", textDecoration: "none", fontWeight: 600, fontSize: "0.84rem" }}
                          title="Call phone number"
                        >
                          {biz.phone}
                        </a>
                        {getWhatsAppUrl(biz.phone) && (
                          <a
                            href={getWhatsAppUrl(biz.phone, generateColdPitch(biz).whatsapp)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="whatsapp-badge"
                            title="Send pre-filled cold outreach pitch to this business on WhatsApp"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageSquare size={11} /> Pitch WA
                          </a>
                        )}
                      </div>
                    ) : null}

                    {biz.email ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <Mail size={12} style={{ color: "#2563eb", flexShrink: 0 }} />
                        <a
                          href={`mailto:${biz.email}`}
                          style={{
                            color: "#1d4ed8",
                            textDecoration: "none",
                            fontSize: "0.82rem",
                            maxWidth: "160px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={`Send email to ${biz.email}`}
                        >
                          {biz.email}
                        </a>
                      </div>
                    ) : null}

                    {!biz.phone && !biz.email && (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8rem" }}>
                        None supplied
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {hasValidWebsite ? (
                    <a
                      href={biz.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--primary)" }}
                    >
                      <Globe size={13} />
                      <span style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {biz.website_url!.replace(/^https?:\/\//, "")}
                      </span>
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8rem" }}>
                      None detected
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge status={biz.website_status} />
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", alignItems: "flex-start" }}>
                    <span className="badge badge-source" title={`Primary Source: ${biz.primary_source || "Public Source"}`}>
                      {biz.primary_source || "Public Source"}
                    </span>
                    <button
                      className="trace-button"
                      title="See how this business was discovered and verified"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectingDiscovery(biz);
                      }}
                    >
                      <Compass size={12} />
                      <span>Trace Origin</span>
                    </button>
                  </div>
                </td>
                <td>
                  <OutreachBadge
                    status={biz.outreach_status}
                    onChange={(newStatus) => updateBusinessOutreach(biz.id, newStatus)}
                  />
                  {biz.outreach_notes && (
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-muted)",
                        marginTop: "4px",
                        maxWidth: "150px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={biz.outreach_notes}
                    >
                      📝 {biz.outreach_notes}
                    </div>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  return (
    <main>
      <header>
        <div className="header-titles">
          <p className="eyebrow">LankaLead · Sales Prospecting & Outreach CRM</p>
          <h1>Sri Lankan business presence & cold outreach engine.</h1>
          <div className="header-meta">
            {providerStatus && (
              <span className="provider-indicator">
                <span className={`provider-dot ${providerStatus.is_healthy ? "" : "offline"}`} />
                <span>Provider: {providerStatus.provider_name} ({providerStatus.is_healthy ? "Online" : "Degraded"})</span>
              </span>
            )}
            <span>Internal Sales Pipeline · Converting offline businesses to digital clients</span>
          </div>
        </div>
        <div className="actions">
          <button onClick={() => exportFiltered("csv")} title="Download pre-formatted tele-sales calling sheet with WhatsApp links">
            <PhoneCall size={14} /> Calling Sheet (CSV)
          </button>
          <button className="secondary" onClick={() => exportFiltered("json")}>
            <Download size={14} /> Export JSON
          </button>
          <button
            className="secondary"
            onClick={() => {
              localStorage.removeItem("lankalead_token");
              setAuthenticated(false);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Active Running Scraper Live Pulse Banner */}
      {runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED") && (
        (() => {
          const activeRun = runs.find((r) => r.status === "RUNNING" || r.status === "QUEUED")!;
          const catName = categories.find((c) => c.id === activeRun.category_id)?.name || "All Categories";
          const locName = activeRun.city || activeRun.district || activeRun.province || "All Sri Lanka";
          return (
            <div className="scraper-pulse-card">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <span className="pulse-beacon" />
                  <strong style={{ fontSize: "1.05rem", letterSpacing: "0.02em" }}>
                    LIVE CRAWLER ACTIVE: [{(activeRun.source_provider || "COMPOSITE").toUpperCase()}]
                  </strong>
                  <span className="badge" style={{ background: "rgba(255,255,255,0.2)", color: "#ffffff" }}>
                    {activeRun.status}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.9 }}>
                  Scraping Target: <strong>{locName}</strong> · Category: <strong>{catName}</strong>
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <div className="pulse-stats-row">
                  <div className="pulse-stat-box">
                    <span className="pulse-stat-val">{activeRun.businesses_found}</span>
                    <span className="pulse-stat-lbl">Discovered</span>
                  </div>
                  <div className="pulse-stat-box">
                    <span className="pulse-stat-val">{activeRun.websites_checked}</span>
                    <span className="pulse-stat-lbl">Checked</span>
                  </div>
                  <div className="pulse-stat-box">
                    <span className="pulse-stat-val" style={{ color: "#86efac" }}>
                      {activeRun.websites_not_detected}
                    </span>
                    <span className="pulse-stat-lbl">No Website</span>
                  </div>
                </div>
                <button
                  className="secondary small"
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    color: "#ffffff",
                    border: "1px solid rgba(255,255,255,0.35)",
                    cursor: "pointer",
                  }}
                  onClick={() => cancelDiscovery(activeRun.id)}
                >
                  Stop Scraper
                </button>
              </div>
            </div>
          );
        })()
      )}

      {/* Collector & Scraper Studio Panel */}
      <section className="scraper-studio">
        <div className="scraper-studio-header">
          <div>
            <p className="eyebrow" style={{ color: "var(--primary)", fontWeight: 800 }}>PROSPECTING ENGINE & WEB CRAWLER</p>
            <h2>Collector & Business Scraper Studio</h2>
            <p>
              Crawl public sources across Sri Lanka to harvest businesses without websites, extract phone numbers, and populate your tele-sales calling list.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="badge badge-verified" style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <Radio size={13} /> {providers.length || 5} Crawlers Active
            </span>
          </div>
        </div>

        {/* 1-Click Quick Presets Bar */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "#4f695b", marginBottom: "8px" }}>
            ⚡ 1-Click Quick Scraper Presets
          </div>
          <div className="scraper-presets-bar">
            <button
              type="button"
              className="scraper-preset-pill"
              onClick={() => applyPresetAndRun("province:Western", "", "composite", 50)}
              title="Scrape businesses across Western Province across all categories"
            >
              🚀 Western Province Cross-Industry (50)
            </button>
            <button
              type="button"
              className="scraper-preset-pill"
              onClick={() => {
                const colombo = locations.find((l) => l.city === "Colombo");
                applyPresetAndRun(colombo ? colombo.id : "province:Western", "", "composite", 50);
              }}
              title="Scrape Colombo prime targets with phone numbers"
            >
              🏙️ Colombo Prime Targets (50)
            </button>
            <button
              type="button"
              className="scraper-preset-pill"
              onClick={() => {
                const galle = locations.find((l) => l.city === "Galle");
                const hotelCat = categories.find((c) => c.slug === "hotels");
                applyPresetAndRun(galle ? galle.id : "province:Southern", hotelCat ? hotelCat.id : "", "directory", 30);
              }}
              title="Scrape Galle hospitality and hotels via RainbowPages Phonebook"
            >
              🏖️ Galle & South Coast Hospitality (30)
            </button>
            <button
              type="button"
              className="scraper-preset-pill"
              onClick={() => {
                const kandy = locations.find((l) => l.city === "Kandy");
                const cafeCat = categories.find((c) => c.slug === "cafes" || c.slug === "restaurants");
                applyPresetAndRun(kandy ? kandy.id : "province:Central", cafeCat ? cafeCat.id : "", "osm", 30);
              }}
              title="Scrape Kandy cafes & food businesses"
            >
              ☕ Kandy Cafes & Food (30)
            </button>
            <button
              type="button"
              className="scraper-preset-pill"
              onClick={() => applyPresetAndRun("", "", "composite", 100)}
              title="Deep sweep across all Sri Lanka"
            >
              🔥 Nationwide Deep Sweep (100)
            </button>
          </div>
        </div>

        {/* Crawler Provider Selection Cards */}
        <div style={{ marginBottom: "18px" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "#4f695b", marginBottom: "8px" }}>
            Select Data Crawler / Source Provider
          </div>
          <div className="provider-grid">
            {(providers.length > 0
              ? providers
              : [
                  {
                    id: "composite",
                    name: "Multi-Source Deep Sweep",
                    description: "Cross-references OSM, RainbowPages Directory, and LinkedIn for highest contact yield.",
                    badge: "Recommended",
                    is_healthy: true,
                  },
                  {
                    id: "osm",
                    name: "OpenStreetMap Places",
                    description: "Overpass API geospatial business nodes and place tags across Sri Lanka.",
                    badge: "Geo Data",
                    is_healthy: true,
                  },
                  {
                    id: "directory",
                    name: "Sri Lanka Directory",
                    description: "Scrapes RainbowPages national directory for local landline & mobile phone numbers.",
                    badge: "Direct Phones",
                    is_healthy: true,
                  },
                  {
                    id: "search",
                    name: "Web & LinkedIn Search",
                    description: "Discovers active local businesses and corporate LinkedIn presences.",
                    badge: "Social Search",
                    is_healthy: true,
                  },
                  {
                    id: "mock",
                    name: "Simulated Dev Dataset",
                    description: "Instant offline mock dataset of Sri Lankan businesses for rapid test runs.",
                    badge: "Test Run",
                    is_healthy: true,
                  },
                ]
            ).map((p) => (
              <div
                key={p.id}
                className={`provider-card ${selectedProvider === p.id ? "active" : ""}`}
                onClick={() => setSelectedProvider(p.id)}
              >
                <div className="provider-card-header">
                  <span className="provider-card-title">{p.name}</span>
                  <span
                    className={`provider-card-badge ${
                      p.id === "composite" ? "provider-badge-recommended" : "provider-badge-other"
                    }`}
                  >
                    {p.badge}
                  </span>
                </div>
                <p className="provider-card-desc">{p.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Scraper Configuration Bar */}
        <div className="scraper-controls-bar">
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "#375043", display: "block", marginBottom: "6px" }}>
              Target Geography
            </label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All Sri Lanka (Nationwide)</option>
              <optgroup label="Provinces (Province-Wide Sweep)">
                {SRI_LANKA_PROVINCES.map((prov) => (
                  <option key={`province:${prov}`} value={`province:${prov}`}>
                    {prov} Province
                  </option>
                ))}
              </optgroup>
              <optgroup label="Cities & Districts">
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.city}, {loc.district} ({loc.province})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "#375043", display: "block", marginBottom: "6px" }}>
              Business Category
            </label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">✨ All Categories (Cross-Industry Sweep)</option>
              {categories.filter((c) => c.slug !== "all").map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "#375043", display: "block", marginBottom: "6px" }}>
              Lead Limit
            </label>
            <div className="limit-selector">
              <button
                type="button"
                className={`limit-pill ${maxRecords === 20 ? "active" : ""}`}
                onClick={() => setMaxRecords(20)}
              >
                20
              </button>
              <button
                type="button"
                className={`limit-pill ${maxRecords === 50 ? "active" : ""}`}
                onClick={() => setMaxRecords(50)}
              >
                50
              </button>
              <button
                type="button"
                className={`limit-pill ${maxRecords === 100 ? "active" : ""}`}
                onClick={() => setMaxRecords(100)}
              >
                100
              </button>
            </div>
          </div>

          <button
            style={{ height: "42px", padding: "0 22px", fontSize: "0.92rem", fontWeight: 700 }}
            disabled={startingDiscovery}
            onClick={() => startDiscovery()}
          >
            {startingDiscovery ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}
            {startingDiscovery ? "Launching..." : "🚀 Launch Scraper"}
          </button>
        </div>

        {runMessage && (
          <p className="helper" style={{ marginTop: "12px", fontWeight: 600, color: "var(--primary)" }}>
            {runMessage}
          </p>
        )}
      </section>

      {/* Runs activity list */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SCRAPER AUDIT LOG</p>
            <h2>Discovery run history</h2>
          </div>
          <p>Runs execute asynchronously with retry backoff, phone/email contact extraction, and SSRF-safe website analysis.</p>
        </div>
        {runs.length === 0 ? (
          <p className="helper">No discovery runs initiated yet.</p>
        ) : (
          <div className="run-list">
            {runs.slice(0, 5).map((run) => (
              <div className="run-row" key={run.id}>
                <div>
                  <div className="run-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{run.city || run.district || run.province || "Sri Lanka"} ·{" "}
                    {categories.find((cat) => cat.id === run.category_id)?.name || "All Categories"}</span>
                    <span className="badge" style={{ fontSize: "0.7rem", background: "#e0f2fe", color: "#0369a1" }}>
                      {(run.source_provider || "composite").toUpperCase()}
                    </span>
                  </div>
                  <span className="run-meta">
                    {run.businesses_found} businesses discovered · {run.websites_checked} websites analyzed ·{" "}
                    {run.websites_found} verified online · <strong style={{ color: "var(--primary)" }}>{run.websites_not_detected} targets without website (Prime Opportunities)</strong>
                  </span>
                  {run.error && <div className="run-error">Error: {run.error}</div>}
                </div>
                <div className="actions">
                  <span className={`badge status-${run.status.toLowerCase()}`}>{run.status}</span>
                  {filterRunId === run.id ? (
                    <button className="secondary small" onClick={() => setFilterRunId("")}>
                      Clear run filter
                    </button>
                  ) : (
                    <button className="secondary small" onClick={() => setFilterRunId(run.id)}>
                      Filter leads to this scrape
                    </button>
                  )}
                  {(run.status === "QUEUED" || run.status === "RUNNING") && (
                    <button className="secondary small" onClick={() => cancelDiscovery(run.id)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sales Pipeline & Outreach KPI Stats */}
      <section className="stats">
        <article
          onClick={() => selectQuickSegment("all")}
          title="Click to view all discovered leads"
        >
          <strong>{leadMetrics?.total_leads ?? totalItems}</strong>
          <span>Total Discovered Leads</span>
        </article>
        <article
          className="prime-target-card"
          onClick={() => selectQuickSegment("prime")}
          title="Click to view Prime Calling Targets (No website + Phone)"
        >
          <strong>🎯 {leadMetrics?.prime_targets ?? 0}</strong>
          <span>Prime Targets (No Website + Phone)</span>
        </article>
        <article
          className="social-card"
          onClick={() => selectQuickSegment("social")}
          title="Click to view businesses with social presence but no website"
        >
          <strong>📱 {leadMetrics?.social_only ?? 0}</strong>
          <span>Social Presence Only (High Upsell)</span>
        </article>
        <article
          className="pipeline-card"
          onClick={() => selectQuickSegment("pipeline")}
          title="Click to view leads in active outreach pipeline"
        >
          <strong>📞 {(leadMetrics?.pipeline_contacted ?? 0) + (leadMetrics?.pipeline_follow_up ?? 0) + (leadMetrics?.pipeline_proposal ?? 0)}</strong>
          <span>In Active Outreach Pipeline</span>
        </article>
        <article
          className="won-card"
          onClick={() => selectQuickSegment("won")}
          title="Click to view closed won website design deals"
        >
          <strong>🏆 {leadMetrics?.pipeline_won ?? 0}</strong>
          <span>Website Deals Won 🎉</span>
        </article>
      </section>

      {/* Quick Pipeline Segment Tabs */}
      <div className="pipeline-tabs">
        <button
          type="button"
          className={`pipeline-tab ${quickSegment === "all" ? "active" : ""}`}
          onClick={() => selectQuickSegment("all")}
        >
          <span>All Leads</span>
          <span className="tab-badge">{leadMetrics?.total_leads ?? totalItems}</span>
        </button>
        <button
          type="button"
          className={`pipeline-tab ${quickSegment === "prime" ? "active" : ""}`}
          onClick={() => selectQuickSegment("prime")}
        >
          <span>⚡ Prime Calling List</span>
          <span className="tab-badge">{leadMetrics?.prime_targets ?? 0}</span>
        </button>
        <button
          type="button"
          className={`pipeline-tab ${quickSegment === "social" ? "active" : ""}`}
          onClick={() => selectQuickSegment("social")}
        >
          <span>📱 Social Only</span>
          <span className="tab-badge">{leadMetrics?.social_only ?? 0}</span>
        </button>
        <button
          type="button"
          className={`pipeline-tab ${quickSegment === "pipeline" ? "active" : ""}`}
          onClick={() => selectQuickSegment("pipeline")}
        >
          <span>📞 Contacted / In Pipeline</span>
          <span className="tab-badge">
            {(leadMetrics?.pipeline_contacted ?? 0) + (leadMetrics?.pipeline_follow_up ?? 0) + (leadMetrics?.pipeline_proposal ?? 0)}
          </span>
        </button>
        <button
          type="button"
          className={`pipeline-tab ${quickSegment === "won" ? "active" : ""}`}
          onClick={() => selectQuickSegment("won")}
        >
          <span>🏆 Deals Won</span>
          <span className="tab-badge">{leadMetrics?.pipeline_won ?? 0}</span>
        </button>
        <button
          type="button"
          className={`pipeline-tab ${quickSegment === "not_interested" ? "active" : ""}`}
          onClick={() => selectQuickSegment("not_interested")}
        >
          <span>✖️ Not Interested</span>
          <span className="tab-badge">{leadMetrics?.pipeline_not_interested ?? 0}</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <section className="filter-toolbar">
        <div>
          <label>Search</label>
          <input
            placeholder="Name, phone, address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadBusinesses(1)}
          />
        </div>
        <div>
          <label>Category</label>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Outreach Stage</label>
          <select value={filterOutreachStatus} onChange={(e) => setFilterOutreachStatus(e.target.value)}>
            <option value="">All Stages</option>
            <option value="NEW">✨ New Leads</option>
            <option value="CONTACTED">📞 Contacted</option>
            <option value="FOLLOW_UP">⏳ Follow-Up Needed</option>
            <option value="PROPOSAL_SENT">📄 Proposal Sent</option>
            <option value="WON">🏆 Deals Won 🎉</option>
            <option value="NOT_INTERESTED">✖️ Not Interested</option>
          </select>
        </div>
        <div>
          <label>Website Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="WEBSITE_FOUND">Website Found</option>
            <option value="WEBSITE_NOT_DETECTED">Website Not Detected</option>
            <option value="WEBSITE_UNCLEAR">Website Status Unclear</option>
            <option value="WEBSITE_UNREACHABLE">Website Unreachable</option>
            <option value="WEBSITE_PARKED">Website Parked</option>
            <option value="SOCIAL_ONLY">Social Presence Only</option>
          </select>
        </div>
        <div>
          <label>Province</label>
          <select value={filterProvince} onChange={(e) => setFilterProvince(e.target.value)}>
            <option value="">All Provinces</option>
            {SRI_LANKA_PROVINCES.map((prov) => (
              <option key={prov} value={prov}>
                {prov} Province
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Sort By</label>
          <select value={`${sortBy}:${sortOrder}`} onChange={(e) => {
            const [sb, so] = e.target.value.split(":");
            setSortBy(sb);
            setSortOrder(so as "asc" | "desc");
          }}>
            <option value="created_at:desc">Newest First</option>
            <option value="created_at:asc">Oldest First</option>
            <option value="name:asc">Name (A-Z)</option>
            <option value="name:desc">Name (Z-A)</option>
            <option value="city:asc">City (A-Z)</option>
            <option value="website_status:asc">Website Status</option>
            <option value="outreach_status:asc">Outreach Stage</option>
            <option value="last_contacted_at:desc">Recently Contacted</option>
          </select>
        </div>
        <div className="actions">
          <button onClick={() => loadBusinesses(1)}>
            <Search size={14} /> Filter
          </button>
          <button className="secondary" onClick={resetFilters}>
            Clear
          </button>
        </div>
      </section>

      {/* Business Results Table */}
      <section className="panel">
        <div className="panel-heading" style={{ alignItems: "center" }}>
          <div>
            <p className="eyebrow">RESULTS</p>
            <h2>Discovered Sri Lankan Businesses ({totalItems})</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div className="view-toggle">
              <button
                type="button"
                className={viewMode === "grouped" ? "active" : ""}
                onClick={() => setViewMode("grouped")}
                title="Organize by category sections"
              >
                <Layers size={13} /> Grouped by Category
              </button>
              <button
                type="button"
                className={viewMode === "table" ? "active" : ""}
                onClick={() => setViewMode("table")}
                title="Unified flat table"
              >
                <Table size={13} /> Flat Table
              </button>
            </div>
          </div>
        </div>

        {filterRunId && (
          <div style={{ marginBottom: "12px" }}>
            <span className="badge badge-inferred">Filtered to Run: {filterRunId.slice(0, 8)}</span>
          </div>
        )}

        {/* Category Navigation Pills Bar */}
        <div className="category-pills-bar">
          <button
            className={`category-pill ${!filterCategory ? "active" : ""}`}
            onClick={() => setFilterCategory("")}
            type="button"
            title="Show all categories"
          >
            <span>All Categories</span>
            <span className="pill-count">{totalItems}</span>
          </button>
          {categories.map((cat) => {
            const count = categoryCounts[cat.name] || 0;
            const isSelected = filterCategory === cat.id;
            return (
              <button
                key={cat.id}
                className={`category-pill ${isSelected ? "active" : ""}`}
                onClick={() => setFilterCategory(isSelected ? "" : cat.id)}
                type="button"
                title={`Filter to ${cat.name}`}
              >
                <span>{getCategoryIcon(cat.name)} {cat.name}</span>
                {count > 0 && <span className="pill-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {viewMode === "grouped" && sortedCategoryNames.length > 0 ? (
          <div>
            {sortedCategoryNames.map((catName) => {
              const list = groupedBusinesses[catName] || [];
              const isCollapsed = collapsedCategories[catName] ?? false;
              const foundCount = list.filter((b) => b.website_status === "WEBSITE_FOUND").length;
              const notDetectedCount = list.filter((b) => b.website_status === "WEBSITE_NOT_DETECTED" || b.website_status === "SOCIAL_ONLY").length;
              const contactsCount = list.filter((b) => b.phone || b.email).length;

              return (
                <div key={catName} className="category-group-card">
                  <div
                    className="category-group-header"
                    onClick={() => setCollapsedCategories((prev) => ({ ...prev, [catName]: !isCollapsed }))}
                  >
                    <div className="category-group-title">
                      <span style={{ fontSize: "1.25rem" }}>{getCategoryIcon(catName)}</span>
                      <h3>{catName}</h3>
                      <span className="badge badge-source" style={{ fontWeight: 700 }}>
                        {list.length} {list.length === 1 ? "business" : "businesses"}
                      </span>
                    </div>

                    <div className="category-group-stats">
                      {foundCount > 0 && (
                        <span className="category-stat-pill found">
                          ✓ {foundCount} Found
                        </span>
                      )}
                      {notDetectedCount > 0 && (
                        <span className="category-stat-pill not-detected">
                          ○ {notDetectedCount} Not Detected
                        </span>
                      )}
                      {contactsCount > 0 && (
                        <span className="category-stat-pill contacts">
                          📞 {contactsCount} Contacts
                        </span>
                      )}
                      <button
                        className="button secondary small"
                        style={{ marginLeft: "6px", padding: "4px 8px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollapsedCategories((prev) => ({ ...prev, [catName]: !isCollapsed }));
                        }}
                      >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        {isCollapsed ? "Expand" : "Collapse"}
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div style={{ overflowX: "auto" }}>
                      {renderBusinessTable(list)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {renderBusinessTable(businesses)}
          </div>
        )}

        {/* Pagination bar */}
        <div className="pagination">
          <div>
            Showing {(page - 1) * pageSize + (businesses.length ? 1 : 0)} to {Math.min(page * pageSize, totalItems)} of {totalItems} businesses
          </div>
          <div className="actions">
            <select
              style={{ width: "auto", padding: "4px 8px", fontSize: "0.82rem" }}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              <option value="10">10 per page</option>
              <option value="25">25 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
            <button
              className="secondary small"
              disabled={page <= 1}
              onClick={() => loadBusinesses(page - 1)}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              className="secondary small"
              disabled={page >= totalPages}
              onClick={() => loadBusinesses(page + 1)}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* Complete Business Detail Modal / View */}
      {selectedBusiness && (
        <div className="modal-overlay" onClick={closeBusiness}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <p className="eyebrow">Business Profile & Presence Analysis</p>
                <h2>{selectedBusiness.name}</h2>
                <div className="detail-badges">
                  <span className="badge badge-verified">
                    <Shield size={12} /> Verified Public Record
                  </span>
                  <StatusBadge status={selectedBusiness.website_status} />
                  <span className="badge badge-inferred">{selectedBusiness.category}</span>
                </div>
              </div>
              <button className="secondary" onClick={closeBusiness}>
                <X size={16} /> Close
              </button>
            </div>

            {/* Target Discovery Provenance Banner */}
            <div className="provenance-banner">
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <Compass size={20} style={{ color: "var(--primary)", flexShrink: 0 }} />
                <div>
                  <strong style={{ fontSize: "0.95rem", color: "#112820" }}>Target Discovery Provenance</strong>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
                    Discovered via <strong>{selectedBusiness.primary_source || selectedBusiness.sources[0]?.name || "Public Data Provider"}</strong>
                    {selectedBusiness.sources[0]?.external_id && (
                      <span style={{ marginLeft: "8px" }} className="badge badge-source">
                        Record ID: {selectedBusiness.sources[0].external_id}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {selectedBusiness.discovery_evidence && (
                <div style={{ marginTop: "10px", fontSize: "0.82rem", background: "white", padding: "8px 12px", borderRadius: "6px", border: "1px solid #dce4de" }}>
                  <strong>Origin Evidence:</strong> {selectedBusiness.discovery_evidence}
                </div>
              )}
            </div>

            {/* Sales Outreach & Pipeline Status CRM Card */}
            <div className="info-card" style={{ marginBottom: "16px", border: "1px solid #cce3d5", background: "#f8fbf9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <h4 style={{ margin: 0, color: "#112820", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>🎯 Tele-Sales Pipeline Stage</span>
                    <OutreachBadge status={selectedBusiness.outreach_status} />
                  </h4>
                  {selectedBusiness.last_contacted_at && (
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "3px", display: "inline-block" }}>
                      Last outreach activity: {new Date(selectedBusiness.last_contacted_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {(["NEW", "CONTACTED", "FOLLOW_UP", "PROPOSAL_SENT", "WON", "NOT_INTERESTED"] as const).map((st) => {
                    const isCurrent = (selectedBusiness.outreach_status || "NEW").toUpperCase() === st;
                    const cfg = OUTREACH_STATUS_CONFIG[st];
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled={savingOutreach}
                        onClick={() => updateBusinessOutreach(selectedBusiness.id, st)}
                        className={`button small ${isCurrent ? "" : "secondary"}`}
                        style={{
                          padding: "4px 10px",
                          fontSize: "0.75rem",
                          borderRadius: "6px",
                          background: isCurrent ? cfg.color : "white",
                          borderColor: cfg.color + "80",
                          color: isCurrent ? "white" : cfg.color,
                          fontWeight: 700,
                        }}
                      >
                        {cfg.icon} {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Call notes / activity log */}
              <div>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Outreach Activity Notes & Call Log</span>
                  {saveSuccessMessage && (
                    <span style={{ color: "#16a34a", fontSize: "0.75rem", textTransform: "none" }}>
                      ✓ {saveSuccessMessage}
                    </span>
                  )}
                </label>
                <textarea
                  className="notes-box"
                  placeholder="Log call outcome, owner name, objections, meeting time, or quote details..."
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                  <button
                    type="button"
                    className="button small"
                    disabled={savingOutreach}
                    onClick={() => updateBusinessOutreach(selectedBusiness.id, undefined, notesDraft)}
                  >
                    {savingOutreach ? <RefreshCw className="spin" size={13} /> : <Check size={13} />}
                    Save Call Notes
                  </button>
                </div>
              </div>
            </div>

            {/* 1-Click WhatsApp Pitch & Tele-Sales Cold Script Generator */}
            {(() => {
              const pitch = generateColdPitch(selectedBusiness);
              const currentScript = pitchTab === "whatsapp" ? pitch.whatsapp : pitch.english;
              return (
                <div className="pitch-card" style={{ marginBottom: "16px" }}>
                  <div className="pitch-header">
                    <div>
                      <strong style={{ fontSize: "0.95rem", color: "#112820", display: "flex", alignItems: "center", gap: "6px" }}>
                        <Sparkles size={16} style={{ color: "var(--primary)" }} />
                        1-Click Cold Outreach & Pitch Generator
                      </strong>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        Tailored specifically for Sri Lankan {selectedBusiness.category} in {selectedBusiness.city || selectedBusiness.district}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {selectedBusiness.phone && (
                        <a
                          href={`tel:${selectedBusiness.phone}`}
                          className="button small secondary"
                          title="Dial phone number now"
                        >
                          <PhoneCall size={13} /> Call {selectedBusiness.phone}
                        </a>
                      )}
                      {getWhatsAppUrl(selectedBusiness.phone) && (
                        <a
                          href={getWhatsAppUrl(selectedBusiness.phone, pitch.whatsapp)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="button small"
                          style={{ background: "#25D366", borderColor: "#25D366", color: "white" }}
                          title="Send pre-filled WhatsApp pitch directly to business"
                        >
                          <Send size={13} /> Send WhatsApp Pitch 🚀
                        </a>
                      )}
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => {
                          navigator.clipboard.writeText(currentScript);
                          setCopiedPitch(true);
                          setTimeout(() => setCopiedPitch(false), 2000);
                        }}
                      >
                        {copiedPitch ? <Check size={13} /> : <Clipboard size={13} />}
                        {copiedPitch ? "Copied!" : "Copy Pitch"}
                      </button>
                    </div>
                  </div>

                  {/* Script tab selector */}
                  <div className="pitch-tab-bar">
                    <button
                      type="button"
                      className={`pitch-tab-btn ${pitchTab === "whatsapp" ? "active" : ""}`}
                      onClick={() => setPitchTab("whatsapp")}
                    >
                      📱 WhatsApp Cold Message (Sinhala & English)
                    </button>
                    <button
                      type="button"
                      className={`pitch-tab-btn ${pitchTab === "call" ? "active" : ""}`}
                      onClick={() => setPitchTab("call")}
                    >
                      📞 Phone Cold Call Script (Opening Pitch)
                    </button>
                  </div>

                  <div className="pitch-content">
                    {currentScript}
                  </div>
                </div>
              );
            })()}

            {/* Business info cards */}
            <div className="grid-two">
              <div className="info-card">
                <h4>Contact & Location</h4>
                <div className="info-row">
                  <span>Address</span>
                  <span>{selectedBusiness.address || "Address not provided"}</span>
                </div>
                <div className="info-row">
                  <span>City / District</span>
                  <span>
                    {selectedBusiness.city}, {selectedBusiness.district}
                  </span>
                </div>
                <div className="info-row">
                  <span>Province</span>
                  <span>{selectedBusiness.province}</span>
                </div>
                <div className="info-row">
                  <span>Phone</span>
                  <span>
                    {selectedBusiness.phone ? (
                      <a href={`tel:${selectedBusiness.phone}`} style={{ color: "var(--primary)", fontWeight: 600 }}>
                        {selectedBusiness.phone}
                      </a>
                    ) : (
                      "Phone not provided"
                    )}
                  </span>
                </div>
                <div className="info-row">
                  <span>Email</span>
                  <span>
                    {selectedBusiness.email ? (
                      <a href={`mailto:${selectedBusiness.email}`} style={{ color: "#1d4ed8", fontWeight: 600 }}>
                        {selectedBusiness.email}
                      </a>
                    ) : (
                      "Email not detected"
                    )}
                  </span>
                </div>

                {/* Direct Contact Actions */}
                {(selectedBusiness.phone || selectedBusiness.email) && (
                  <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #e7ede9", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {selectedBusiness.phone && (
                      <a href={`tel:${selectedBusiness.phone}`} className="button small secondary">
                        <Phone size={13} /> Call
                      </a>
                    )}
                    {getWhatsAppUrl(selectedBusiness.phone) && (
                      <a
                        href={getWhatsAppUrl(selectedBusiness.phone)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button small"
                        style={{ background: "#25D366", borderColor: "#25D366", color: "white" }}
                      >
                        <MessageSquare size={13} /> WhatsApp
                      </a>
                    )}
                    {selectedBusiness.email && (
                      <a href={`mailto:${selectedBusiness.email}`} className="button small secondary">
                        <Mail size={13} /> Send Email
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="info-card">
                <h4>Sources & Social Presence</h4>
                <div className="info-row">
                  <span>Primary Source</span>
                  <span>{selectedBusiness.sources[0]?.name || "Public Provider"}</span>
                </div>
                {selectedBusiness.sources.map((src) => (
                  <div className="info-row" key={src.external_id}>
                    <span>Source Record</span>
                    <span>
                      {src.external_id}{" "}
                      {src.source_url && (
                        <a href={src.source_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </span>
                  </div>
                ))}
                {selectedBusiness.social_profiles.length > 0 ? (
                  selectedBusiness.social_profiles.map((p) => (
                    <div className="info-row" key={p.profile_url}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <span className="badge badge-source" style={{ textTransform: "none", fontSize: "0.75rem", padding: "2px 8px" }}>
                          {p.platform === "LinkedIn" ? "💼 LinkedIn" : p.platform === "Facebook" ? "📘 Facebook" : p.platform === "Instagram" ? "📸 Instagram" : p.platform}
                        </span>
                      </span>
                      <a
                        href={p.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: "4px", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={p.profile_url}
                      >
                        {p.profile_url.replace(/^https?:\/\/(?:www\.)?/, "")} <ExternalLink size={11} />
                      </a>
                    </div>
                  ))
                ) : (
                  <div className="info-row">
                    <span>Social Media</span>
                    <span style={{ color: "var(--text-muted)" }}>None detected</span>
                  </div>
                )}
              </div>
            </div>

            {/* Website Analysis Details */}
            <div className="panel" style={{ padding: "20px", marginBottom: "20px" }}>
              <div className="panel-heading" style={{ marginBottom: "12px" }}>
                <div>
                  <p className="eyebrow">WEBSITE CANDIDATE ANALYSIS</p>
                  <h3>
                    {selectedBusiness.website && selectedBusiness.website.url.toLowerCase() !== "none" && !selectedBusiness.website.url.includes("://none")
                      ? selectedBusiness.website.url
                      : "No website candidate supplied"}
                  </h3>
                </div>
                {selectedBusiness.website && selectedBusiness.website.url.toLowerCase() !== "none" && !selectedBusiness.website.url.includes("://none") && (
                  <a
                    href={selectedBusiness.website.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button secondary small"
                  >
                    Visit Candidate <ExternalLink size={12} />
                  </a>
                )}
              </div>

              {selectedBusiness.website?.checks && selectedBusiness.website.checks.length > 0 ? (
                <div>
                  <h4 style={{ fontSize: "0.82rem", textTransform: "uppercase", color: "var(--text-muted)", margin: "16px 0 8px" }}>
                    Website Check History ({selectedBusiness.website.checks.length} check
                    {selectedBusiness.website.checks.length > 1 ? "s" : ""})
                  </h4>
                  {selectedBusiness.website.checks.map((chk, idx) => (
                    <div className="check-card" key={idx}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong>Check conducted at {new Date(chk.checked_at).toLocaleString()}</strong>
                        <span className="badge badge-inferred">
                          Confidence: {Math.round((chk.confidence_score ?? 0.5) * 100)}%
                        </span>
                      </div>

                      <div className="check-metrics">
                        <div className="metric-box">
                          <span>HTTP Status</span>
                          <strong>{chk.http_status ?? "Unreachable"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>HTTPS Valid</span>
                          <strong>{chk.https ? "Yes" : "No"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>Latency</span>
                          <strong>{chk.response_time_ms ? `${chk.response_time_ms} ms` : "—"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>Robots.txt</span>
                          <strong>{chk.has_robots_txt ? "Present" : "Not Found"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>Sitemap</span>
                          <strong>{chk.has_sitemap ? "Present" : "Not Found"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>Domain Parked</span>
                          <strong>{chk.is_parked ? "Yes (For Sale)" : "No"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>Name Match</span>
                          <strong>{chk.name_matched ? "Yes" : "No match"}</strong>
                        </div>
                        <div className="metric-box">
                          <span>Phone Match</span>
                          <strong>{chk.phone_matched ? "Yes" : "No match"}</strong>
                        </div>
                      </div>

                      {chk.title && (
                        <div style={{ fontSize: "0.85rem", marginTop: "8px" }}>
                          <strong>Page Title:</strong> {chk.title}
                        </div>
                      )}
                      {chk.meta_description && (
                        <div style={{ fontSize: "0.85rem", marginTop: "4px", color: "var(--text-muted)" }}>
                          <strong>Meta Description:</strong> {chk.meta_description}
                        </div>
                      )}
                      {chk.redirect_chain && chk.redirect_chain.length > 1 && (
                        <div className="redirect-chain">
                          <strong>Redirect chain:</strong> {chk.redirect_chain.join(" ➔ ")}
                        </div>
                      )}
                      {chk.error && (
                        <div style={{ color: "#b32626", fontSize: "0.82rem", marginTop: "6px" }}>
                          <strong>Error encountered:</strong> {chk.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="helper">No website check records available for this business.</p>
              )}
            </div>

            {/* Evidence Timeline */}
            <div className="panel" style={{ padding: "20px" }}>
              <p className="eyebrow">CHRONOLOGICAL AUDIT TRAIL</p>
              <h3 style={{ margin: "4px 0 16px" }}>Evidence Timeline</h3>
              <div className="timeline">
                {selectedBusiness.timeline.map((item, idx) => (
                  <div className="timeline-item" key={idx}>
                    <div className="timeline-dot" />
                    <div className="timeline-header">
                      <span className="timeline-title">{item.title}</span>
                      <span className="badge badge-inferred" style={{ fontSize: "0.68rem" }}>
                        {item.label}
                      </span>
                      {item.timestamp && (
                        <span className="timeline-time">{new Date(item.timestamp).toLocaleDateString()}</span>
                      )}
                    </div>
                    <p className="timeline-detail">{item.detail}</p>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "0.8rem", color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: "3px", marginTop: "3px" }}
                      >
                        Link <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Target Discovery Origin & Provenance Modal */}
      {inspectingDiscovery && (
        <div className="modal-overlay" onClick={() => setInspectingDiscovery(null)}>
          <div className="modal-content" style={{ maxWidth: "760px" }} onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <p className="eyebrow">TARGET DISCOVERY ORIGIN & AUDIT TRAIL</p>
                <h2 style={{ fontSize: "1.5rem" }}>{inspectingDiscovery.name}</h2>
                <div className="detail-badges">
                  <span className="badge badge-source">
                    <Compass size={12} /> {inspectingDiscovery.primary_source || "Public Source"}
                  </span>
                  <StatusBadge status={inspectingDiscovery.website_status} />
                  <span className="badge badge-inferred">{inspectingDiscovery.category}</span>
                </div>
              </div>
              <button className="secondary" onClick={() => setInspectingDiscovery(null)}>
                <X size={16} /> Close
              </button>
            </div>

            <div className="grid-two" style={{ marginBottom: "20px" }}>
              <div className="origin-card">
                <h4>Provider & Identification</h4>
                <div className="info-row">
                  <span>Provider Source</span>
                  <strong>{inspectingDiscovery.primary_source || "Public Provider"}</strong>
                </div>
                {inspectingDiscovery.sources && inspectingDiscovery.sources.length > 0 ? (
                  inspectingDiscovery.sources.map((src) => (
                    <div className="info-row" key={src.external_id}>
                      <span>Source Record</span>
                      <span>
                        {src.external_id}{" "}
                        {src.source_url && (
                          <a
                            href={src.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: "2px", marginLeft: "4px" }}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="info-row">
                    <span>Record ID</span>
                    <span>Provider reference captured</span>
                  </div>
                )}
                <div className="info-row">
                  <span>Ingestion Quality</span>
                  <span className="badge badge-found" style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
                    Verified Record
                  </span>
                </div>
              </div>

              <div className="origin-card">
                <h4>Discovery Query Context</h4>
                <div className="info-row">
                  <span>Category Matched</span>
                  <strong>{inspectingDiscovery.category}</strong>
                </div>
                <div className="info-row">
                  <span>Target Area</span>
                  <span>
                    {inspectingDiscovery.city}, {inspectingDiscovery.district}
                  </span>
                </div>
                <div className="info-row">
                  <span>Province</span>
                  <span>{inspectingDiscovery.province}</span>
                </div>
                <div className="info-row">
                  <span>Phone</span>
                  <span>
                    {inspectingDiscovery.phone ? (
                      <a href={`tel:${inspectingDiscovery.phone}`} style={{ color: "var(--primary)", fontWeight: 600 }}>
                        {inspectingDiscovery.phone}
                      </a>
                    ) : (
                      "No phone in source"
                    )}
                  </span>
                </div>
                <div className="info-row">
                  <span>Email</span>
                  <span>
                    {inspectingDiscovery.email ? (
                      <a href={`mailto:${inspectingDiscovery.email}`} style={{ color: "#1d4ed8", fontWeight: 600 }}>
                        {inspectingDiscovery.email}
                      </a>
                    ) : (
                      "No email in source"
                    )}
                  </span>
                </div>
                {(inspectingDiscovery.phone || inspectingDiscovery.email) && (
                  <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {inspectingDiscovery.phone && (
                      <a href={`tel:${inspectingDiscovery.phone}`} className="button small secondary">
                        <Phone size={12} /> Call
                      </a>
                    )}
                    {getWhatsAppUrl(inspectingDiscovery.phone) && (
                      <a
                        href={getWhatsAppUrl(inspectingDiscovery.phone)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button small"
                        style={{ background: "#25D366", borderColor: "#25D366", color: "white" }}
                      >
                        <MessageSquare size={12} /> WhatsApp
                      </a>
                    )}
                    {inspectingDiscovery.email && (
                      <a href={`mailto:${inspectingDiscovery.email}`} className="button small secondary">
                        <Mail size={12} /> Email
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="origin-card" style={{ marginBottom: "20px" }}>
              <h4>Web & Social Footprint Found</h4>
              <div className="info-row">
                <span>Website Candidate</span>
                {inspectingDiscovery.website_url && inspectingDiscovery.website_url.toLowerCase() !== "none" && !inspectingDiscovery.website_url.includes("://none") ? (
                  <a
                    href={inspectingDiscovery.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}
                  >
                    <Globe size={13} /> {inspectingDiscovery.website_url} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No website candidate detected in source</span>
                )}
              </div>
              <div className="info-row">
                <span>Website Presence Status</span>
                <StatusBadge status={inspectingDiscovery.website_status} />
              </div>
              <div className="info-row">
                <span>Social Profiles Discovered</span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {inspectingDiscovery.social_profiles && inspectingDiscovery.social_profiles.length > 0 ? (
                    inspectingDiscovery.social_profiles.map((p) => (
                      <a
                        key={p.profile_url}
                        href={p.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="badge badge-source"
                        style={{ textDecoration: "none" }}
                      >
                        {p.platform === "LinkedIn" ? "💼 LinkedIn" : p.platform === "Facebook" ? "📘 Facebook" : p.platform === "Instagram" ? "📸 Instagram" : p.platform}
                      </a>
                    ))
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>No social media attached</span>
                  )}
                </div>
              </div>
            </div>

            <div className="origin-card" style={{ marginBottom: "24px" }}>
              <h4>Discovery Audit Log & Verification Evidence</h4>
              <div className="evidence-box">
                {inspectingDiscovery.discovery_evidence ||
                  `[DISCOVERY AUDIT] Target "${inspectingDiscovery.name}" resolved via provider "${inspectingDiscovery.primary_source || "Public Source"}" in ${inspectingDiscovery.city}, ${inspectingDiscovery.district}. Category mapped to ${inspectingDiscovery.category}. Website presence classified as ${inspectingDiscovery.website_status}.`}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={() => {
                  const id = inspectingDiscovery.id;
                  setInspectingDiscovery(null);
                  openBusiness(id);
                }}
              >
                View Full Profile & Website Checks
              </button>
              <button className="secondary" onClick={() => setInspectingDiscovery(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

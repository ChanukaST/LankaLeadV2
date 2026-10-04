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
  Clock,
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

function generateColdPitch(biz: Business): { english: string; whatsapp: string; tiktok: string } {
  const cat = biz.category || "business";
  const loc = [biz.city, biz.district].filter(Boolean).join(", ") || "Sri Lanka";
  const tiktokProfile = biz.social_profiles?.find((s) => s.platform.toLowerCase() === "tiktok");

  const english = `Hello! Is this the manager or owner of ${biz.name}?

I was looking for ${cat} in ${loc} and came across your profile. You have great local visibility, but when customers search online, you don't have an official website or menu/services catalog yet.

We build modern, mobile-friendly websites specifically for Sri Lankan ${cat} businesses to help you capture direct orders, customer inquiries, and rank higher on Google Maps.

Would you be open to a quick 2-minute chat, or could I send you a 1-minute free preview over WhatsApp?`;

  const whatsapp = `Ayubowan / Hello ${biz.name} team! 🙏

I noticed that your business (${cat} in ${loc}) doesn't have an official website yet.

Today, over 80% of customers search on Google and social media before visiting or ordering. We build affordable, high-converting websites and Google Maps setups tailored for Sri Lankan businesses so you can receive direct customer inquiries, bookings, and payments.

Would you like to see a free quick mockup website we could create for ${biz.name}?

Looking forward to hearing from you!`;

  const tiktok = `Ayubowan / Hello ${biz.name} team! 🙏

We came across your TikTok profile (${tiktokProfile?.profile_url || "@" + biz.name.toLowerCase().replace(/\s+/g, "")}) and loved your content and engagement!

We noticed you don't have an official website link in your TikTok bio yet. Right now, when your videos get views, interested customers have to message you manually and wait for replies, causing many lost sales.

We build fast mobile websites & online catalogs designed specifically to link directly in your TikTok bio. In 48 hours, you can have a direct WhatsApp order catalog, pricing menu, or appointment booking system working for you 24/7!

Would you like us to send you a free 1-minute mockup preview for ${biz.name}?`;

  return { english, whatsapp, tiktok };
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
    if (response.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
      localStorage.removeItem("lankalead_token");
      window.dispatchEvent(
        new CustomEvent("lankalead:unauthorized", {
          detail: {
            message: "Your session has expired. Please sign in again.",
          },
        })
      );
      throw new Error("Your session has expired. Please sign in again.");
    }
    const body = (await response.json().catch(() => null)) as {
      detail?: string | { code?: string; message?: string };
    } | null;
    let errorMsg = `Request failed (${response.status})`;
    if (body?.detail) {
      if (typeof body.detail === "string") {
        errorMsg = body.detail;
      } else if (typeof body.detail === "object" && body.detail.message) {
        errorMsg = body.detail.message;
      }
    }
    throw new Error(errorMsg);
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
  const [quickSegment, setQuickSegment] = useState<"all" | "prime" | "social" | "pipeline" | "won" | "not_interested">("prime");
  const [filterOutreachStatus, setFilterOutreachStatus] = useState("");
  const [filterPrimeLeads, setFilterPrimeLeads] = useState(true);
  const [filterSocialOnly, setFilterSocialOnly] = useState(false);

  // Outreach editing state in Modal
  const [notesDraft, setNotesDraft] = useState("");
  const [savingOutreach, setSavingOutreach] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
  const [copiedPitch, setCopiedPitch] = useState(false);
  const [pitchTab, setPitchTab] = useState<"whatsapp" | "call" | "tiktok">("whatsapp");


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

  // UI state
  const [runMessage, setRunMessage] = useState("");
  const [startingDiscovery, setStartingDiscovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Sign in or create an account to start business discovery.");
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("lankalead_token")));

  // Global auth listener & session validation
  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      const customMsg = (event as CustomEvent<{ message?: string }>).detail?.message;
      localStorage.removeItem("lankalead_token");
      setAuthenticated(false);
      setMessage(customMsg || "Your session has expired. Please sign in again.");
    };
    window.addEventListener("lankalead:unauthorized", handleUnauthorized);

    const token = localStorage.getItem("lankalead_token");
    if (token) {
      api<{ id: string; email: string }>("/auth/me")
        .then(() => {
          setAuthenticated(true);
        })
        .catch(() => {
          // Handled automatically by 401 interceptor in api()
        });
    } else {
      setAuthenticated(false);
    }

    return () => window.removeEventListener("lankalead:unauthorized", handleUnauthorized);
  }, []);

  // Periodic token refresh to maintain continuous session for internal tele-sales team
  useEffect(() => {
    if (!authenticated) return;
    const interval = window.setInterval(async () => {
      try {
        const refreshed = await api<{ access_token: string }>("/auth/refresh", { method: "POST" });
        if (refreshed?.access_token) {
          localStorage.setItem("lankalead_token", refreshed.access_token);
        }
      } catch {
        // Handled by 401 interceptor if invalid
      }
    }, 1000 * 60 * 30); // every 30 minutes
    return () => window.clearInterval(interval);
  }, [authenticated]);

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
      setRunMessage("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Login failed. Check your email or password.");
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
      setRunMessage("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Registration failed. Use a valid email and 8+ character password.");
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
      if (response.status === 401) {
        localStorage.removeItem("lankalead_token");
        window.dispatchEvent(
          new CustomEvent("lankalead:unauthorized", {
            detail: { message: "Your session has expired. Please sign in again." },
          })
        );
        return;
      }
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
    const isAuthWarning =
      message.toLowerCase().includes("expired") ||
      message.toLowerCase().includes("invalid") ||
      message.toLowerCase().includes("failed");
    return (
      <main className="auth">
        <section className="auth-card">
          <p className="eyebrow">LANKALEAD</p>
          <h1>Understand the online presence of Sri Lankan businesses.</h1>
          <div className={`auth-message ${isAuthWarning ? "warning" : ""}`}>
            {isAuthWarning ? "⚠️ " : "ℹ️ "}
            {message}
          </div>
          <div>
            <label>Email address</label>
            <input
              placeholder="name@company.lk"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && authenticate()}
            />
          </div>
          <div>
            <label>Password (8+ chars)</label>
            <input
              placeholder="••••••••"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && authenticate()}
            />
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

  const handleSortToggle = (col: string) => {
    if (sortBy === col) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortOrder(col === "name" || col === "city" ? "asc" : "desc");
    }
  };

  const getSortIcon = (col: string) => {
    if (sortBy !== col) return <span className="sort-hint">⇅</span>;
    return <span className="sort-active">{sortOrder === "asc" ? " ▲" : " ▼"}</span>;
  };

  const renderBusinessTable = (items: Business[]) => (
    <table>
      <thead>
        <tr>
          <th
            className="sortable-col"
            onClick={() => handleSortToggle("name")}
            title="Click to sort by Business Name"
          >
            Business & Category {getSortIcon("name")}
          </th>
          <th
            className="sortable-col"
            onClick={() => handleSortToggle("city")}
            title="Click to sort by City / Location"
          >
            Location {getSortIcon("city")}
          </th>
          <th>Contact & Direct Pitch</th>
          <th
            className="sortable-col"
            onClick={() => handleSortToggle("website_status")}
            title="Click to sort by Website Status"
          >
            Website Status {getSortIcon("website_status")}
          </th>
          <th
            className="sortable-col"
            onClick={() => handleSortToggle("last_contacted_at")}
            title="Click to sort by Sales Pipeline / Recent Contact"
          >
            Sales Pipeline & Notes {getSortIcon("last_contacted_at")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={5} style={{ textAlign: "center", padding: "36px", color: "var(--text-muted)" }}>
              No businesses found matching current filters. Run a search above or switch segment tabs.
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
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <button
                      className="link-button"
                      style={{ fontSize: "0.95rem", fontWeight: 700 }}
                      onClick={() => openBusiness(biz.id)}
                      title="Click to view full profile & cold outreach pitch scripts"
                    >
                      {biz.name}
                    </button>
                    <div>
                      <span className="badge-category">
                        {getCategoryIcon(biz.category)} {biz.category}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#374151" }}>
                    <MapPin size={13} style={{ color: "var(--primary)", flexShrink: 0 }} />
                    <span>{locationDisplay}</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {biz.phone ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <a
                          href={`tel:${biz.phone}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            color: "inherit",
                            textDecoration: "none",
                            fontWeight: 700,
                            fontSize: "0.88rem",
                          }}
                          title="Click to dial phone number directly"
                        >
                          <Phone size={13} style={{ color: "var(--primary)" }} />
                          {biz.phone}
                        </a>
                        {getWhatsAppUrl(biz.phone) && (
                          <a
                            href={getWhatsAppUrl(biz.phone, generateColdPitch(biz).whatsapp)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="whatsapp-badge"
                            title="Open WhatsApp with pre-filled website development pitch"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageSquare size={11} /> Pitch WA
                          </a>
                        )}
                      </div>
                    ) : null}

                    {biz.email ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                        <Mail size={12} style={{ color: "#2563eb", flexShrink: 0 }} />
                        <a
                          href={`mailto:${biz.email}`}
                          style={{
                            color: "#1d4ed8",
                            textDecoration: "none",
                            fontSize: "0.82rem",
                            maxWidth: "180px",
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

                    {biz.social_profiles && biz.social_profiles.length > 0 && (
                      <div style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                        {biz.social_profiles.map((p) => (
                          <a
                            key={p.profile_url}
                            href={p.profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: "0.72rem",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: p.platform === "TikTok" ? "#0f172a" : p.platform === "Instagram" ? "#fce7f3" : p.platform === "Facebook" ? "#eff6ff" : "#f1f5f9",
                              color: p.platform === "TikTok" ? "#38bdf8" : p.platform === "Instagram" ? "#be185d" : p.platform === "Facebook" ? "#1d4ed8" : "#334155",
                              textDecoration: "none",
                              fontWeight: 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              border: p.platform === "TikTok" ? "1px solid #334155" : "none",
                            }}
                            title={`Open ${p.platform} profile`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.platform === "TikTok" ? "🎵 TikTok" : p.platform === "Instagram" ? "📸 IG" : p.platform === "Facebook" ? "📘 FB" : p.platform === "LinkedIn" ? "💼 LinkedIn" : p.platform}
                          </a>
                        ))}
                      </div>
                    )}

                    {!biz.phone && !biz.email && (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8rem" }}>
                        No direct contact supplied
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                    <StatusBadge status={biz.website_status} />
                    {hasValidWebsite && (
                      <a
                        href={biz.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          color: "var(--primary)",
                          fontSize: "0.78rem",
                          maxWidth: "180px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <ExternalLink size={11} />
                        {biz.website_url!.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                    <OutreachBadge
                      status={biz.outreach_status}
                      onChange={(newStatus) => updateBusinessOutreach(biz.id, newStatus)}
                    />
                    {biz.outreach_notes ? (
                      <div
                        style={{
                          fontSize: "0.76rem",
                          color: "var(--text-muted)",
                          maxWidth: "180px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                        title={`${biz.outreach_notes} (Click to edit)`}
                        onClick={() => openBusiness(biz.id)}
                      >
                        📝 {biz.outreach_notes}
                      </div>
                    ) : (
                      <button
                        className="link-button"
                        style={{ fontSize: "0.72rem", color: "var(--text-muted)", textDecoration: "none" }}
                        onClick={() => openBusiness(biz.id)}
                      >
                        + Add note
                      </button>
                    )}
                  </div>
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

      {/* STEP 1: LEAD COLLECTOR CARD */}
      <section className="collector-step-card">
        <div className="step-badge-row">
          <span className="step-pill">Step 1</span>
          <span className="step-title">Find Businesses to Call</span>
        </div>
        <p className="step-desc">
          Scan Sri Lankan directories and maps to discover local businesses and check if they have a website.
        </p>

        <div className="collector-form-row">
          <div className="form-field">
            <label>1. Location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All Sri Lanka (Nationwide)</option>
              <optgroup label="Provinces">
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

          <div className="form-field">
            <label>2. Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">✨ All Categories (Broad Search)</option>
              {categories.filter((c) => c.slug !== "all").map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field" style={{ maxWidth: "160px" }}>
            <label>3. How Many Leads</label>
            <select value={maxRecords} onChange={(e) => setMaxRecords(Number(e.target.value))}>
              <option value={20}>20 Businesses</option>
              <option value={50}>50 Businesses</option>
              <option value={100}>100 Businesses</option>
            </select>
          </div>

          <div className="form-field" style={{ maxWidth: "240px" }}>
            <label>4. Search Source</label>
            <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
              {providers && providers.length > 0 ? (
                providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === "composite" && "⚡ "}
                    {p.id === "tiktok" && "🎵 "}
                    {p.id === "osm" && "🗺️ "}
                    {p.id === "directory" && "📖 "}
                    {p.id === "search" && "🔍 "}
                    {p.id === "mock" && "🧪 "}
                    {p.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="composite">⚡ Multi-Source Deep Sweep</option>
                  <option value="tiktok">🎵 TikTok Local Business Discovery</option>
                  <option value="osm">🗺️ OpenStreetMap Places</option>
                  <option value="directory">📖 RainbowPages Phone Directory</option>
                  <option value="search">🔍 Web & LinkedIn Search</option>
                </>
              )}
            </select>
          </div>


          <div className="form-action">
            <button
              className="launch-button"
              disabled={startingDiscovery}
              onClick={() => startDiscovery()}
            >
              {startingDiscovery ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}
              {startingDiscovery ? "Searching..." : "🚀 Find Businesses"}
            </button>
          </div>
        </div>

        {runMessage && (
          <div className="collector-message">
            {runMessage}
          </div>
        )}
      </section>

      {/* STEP 2: REVIEW TARGETS & CALLING PIPELINE */}
      <section className="pipeline-section">
        <div className="step-badge-row">
          <span className="step-pill">Step 2</span>
          <span className="step-title">Review Targets & Start Calling</span>
        </div>
        <p className="step-desc">
          Focus on businesses with verified phone numbers that do not have a website. Click any business to view their pitch script.
        </p>

        {/* 4 Clean Metric Cards */}
        <div className="stats-clean-grid">
          <div
            className={`metric-clean-card ${quickSegment === "prime" ? "active" : ""}`}
            onClick={() => selectQuickSegment("prime")}
            title="Filter to Prime Targets: No website detected, phone number available"
          >
            <div className="metric-icon-wrap prime">🎯</div>
            <div>
              <div className="metric-clean-val">{leadMetrics?.prime_targets ?? 0}</div>
              <div className="metric-clean-lbl">Prime Calling Targets (No Website)</div>
            </div>
          </div>

          <div
            className={`metric-clean-card ${quickSegment === "social" ? "active" : ""}`}
            onClick={() => selectQuickSegment("social")}
            title="Filter to Social Only: Has Facebook/Instagram presence, but no official website"
          >
            <div className="metric-icon-wrap social">📱</div>
            <div>
              <div className="metric-clean-val">{leadMetrics?.social_only ?? 0}</div>
              <div className="metric-clean-lbl">Social Media Only (Ready for Website)</div>
            </div>
          </div>

          <div
            className={`metric-clean-card ${quickSegment === "pipeline" ? "active" : ""}`}
            onClick={() => selectQuickSegment("pipeline")}
            title="Filter to Active Pipeline: Contacted or in negotiation"
          >
            <div className="metric-icon-wrap pipeline">📞</div>
            <div>
              <div className="metric-clean-val">
                {(leadMetrics?.pipeline_contacted ?? 0) + (leadMetrics?.pipeline_follow_up ?? 0) + (leadMetrics?.pipeline_proposal ?? 0)}
              </div>
              <div className="metric-clean-lbl">In Active Outreach</div>
            </div>
          </div>

          <div
            className={`metric-clean-card ${quickSegment === "won" ? "active" : ""}`}
            onClick={() => selectQuickSegment("won")}
            title="Filter to Closed Won Deals"
          >
            <div className="metric-icon-wrap won">🏆</div>
            <div>
              <div className="metric-clean-val">{leadMetrics?.pipeline_won ?? 0}</div>
              <div className="metric-clean-lbl">Deals Closed Won 🎉</div>
            </div>
          </div>
        </div>

        {/* Intuitive Segment Tabs */}
        <div className="calling-segment-tabs">
          <button
            type="button"
            className={`calling-tab ${quickSegment === "prime" ? "active" : ""}`}
            onClick={() => selectQuickSegment("prime")}
          >
            🎯 Prime Targets (No Website)
            <span className="tab-pill-badge">{leadMetrics?.prime_targets ?? 0}</span>
          </button>
          <button
            type="button"
            className={`calling-tab ${quickSegment === "social" ? "active" : ""}`}
            onClick={() => selectQuickSegment("social")}
          >
            📱 Social Media Only
            <span className="tab-pill-badge">{leadMetrics?.social_only ?? 0}</span>
          </button>
          <button
            type="button"
            className={`calling-tab ${quickSegment === "pipeline" ? "active" : ""}`}
            onClick={() => selectQuickSegment("pipeline")}
          >
            📞 Contacted / In Pipeline
            <span className="tab-pill-badge">
              {(leadMetrics?.pipeline_contacted ?? 0) + (leadMetrics?.pipeline_follow_up ?? 0) + (leadMetrics?.pipeline_proposal ?? 0)}
            </span>
          </button>
          <button
            type="button"
            className={`calling-tab ${quickSegment === "won" ? "active" : ""}`}
            onClick={() => selectQuickSegment("won")}
          >
            🏆 Deals Won
            <span className="tab-pill-badge">{leadMetrics?.pipeline_won ?? 0}</span>
          </button>
          <button
            type="button"
            className={`calling-tab ${quickSegment === "all" ? "active" : ""}`}
            onClick={() => selectQuickSegment("all")}
          >
            All Leads ({leadMetrics?.total_leads ?? totalItems})
          </button>
        </div>

        {/* Clean, Simple Filter Bar */}
        <div className="leads-filter-bar">
          <div className="filter-input-wrap">
            <Search size={15} className="filter-icon" />
            <input
              type="text"
              placeholder="Search by business name, phone, or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadBusinesses(1)}
            />
          </div>

          <div style={{ minWidth: "180px" }}>
            <select value={filterProvince} onChange={(e) => setFilterProvince(e.target.value)}>
              <option value="">All Provinces</option>
              {SRI_LANKA_PROVINCES.map((prov) => (
                <option key={prov} value={prov}>{prov} Province</option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: "180px" }}>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="sort-select-wrap">
            <span className="sort-label">Sort:</span>
            <select
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const [newSort, newOrder] = e.target.value.split(":");
                setSortBy(newSort);
                setSortOrder(newOrder as "asc" | "desc");
              }}
              title="Change sort order of leads"
            >
              <option value="created_at:desc">⚡ Newest Discovered</option>
              <option value="created_at:asc">📅 Oldest Discovered</option>
              <option value="name:asc">🔤 Name (A → Z)</option>
              <option value="name:desc">🔤 Name (Z → A)</option>
              <option value="city:asc">📍 City (A → Z)</option>
              <option value="website_status:asc">🌐 Website Status</option>
              <option value="last_contacted_at:desc">📞 Recently Contacted</option>
            </select>
          </div>

          {(search || filterProvince || filterCategory || filterDistrict || filterCity || filterStatus || filterRunId || sortBy !== "created_at" || sortOrder !== "desc") && (
            <button className="secondary small" onClick={resetFilters}>
              Reset Filters
            </button>
          )}
        </div>

        {filterRunId && (
          <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="badge badge-inferred">Filtered to Scraper Run: {filterRunId.slice(0, 8)}</span>
            <button className="link-button" style={{ fontSize: "0.8rem" }} onClick={() => setFilterRunId("")}>
              Clear run filter
            </button>
          </div>
        )}

        {/* Step 3: Leads Table Card */}
        <div className="table-responsive-card">
          <div style={{ overflowX: "auto" }}>
            {renderBusinessTable(businesses)}
          </div>

          {/* Clean Pagination Bar */}
          <div className="pagination-bar">
            <div className="pagination-info">
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalItems} total leads)
            </div>
            <div className="pagination-controls">
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
              <button
                className="secondary small"
                disabled={page >= totalPages}
                onClick={() => loadBusinesses(page + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Collapsible Crawler Run History Drawer */}
      <details className="history-details-drawer">
        <summary className="history-details-summary">
          <Clock size={15} />
          <span>View Crawler History ({runs.length} runs executed)</span>
        </summary>
        <div className="history-details-content">
          {runs.length === 0 ? (
            <p className="helper">No discovery runs initiated yet.</p>
          ) : (
            <div className="run-list">
              {runs.slice(0, 10).map((run) => (
                <div className="run-row" key={run.id}>
                  <div>
                    <div className="run-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span>{run.city || run.district || run.province || "Sri Lanka"} · {categories.find((cat) => cat.id === run.category_id)?.name || "All Categories"}</span>
                      <span className="badge" style={{ fontSize: "0.7rem", background: "#e0f2fe", color: "#0369a1" }}>
                        {(run.source_provider || "composite").toUpperCase()}
                      </span>
                    </div>
                    <span className="run-meta">
                      {run.businesses_found} businesses discovered · {run.websites_checked} checked ·{" "}
                      <strong style={{ color: "var(--primary)" }}>{run.websites_not_detected} targets without website</strong>
                    </span>
                  </div>
                  <div className="actions">
                    <span className={`badge status-${run.status.toLowerCase()}`}>{run.status}</span>
                    {filterRunId === run.id ? (
                      <button className="secondary small" onClick={() => setFilterRunId("")}>
                        Clear
                      </button>
                    ) : (
                      <button className="secondary small" onClick={() => setFilterRunId(run.id)}>
                        Filter to Run
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

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
              const currentScript = pitchTab === "whatsapp" ? pitch.whatsapp : (pitchTab === "tiktok" ? pitch.tiktok : pitch.english);
              const whatsappSendPitch = pitchTab === "tiktok" ? pitch.tiktok : pitch.whatsapp;
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
                          href={getWhatsAppUrl(selectedBusiness.phone, whatsappSendPitch)!}
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
                      📱 WhatsApp Cold Pitch
                    </button>
                    <button
                      type="button"
                      className={`pitch-tab-btn ${pitchTab === "call" ? "active" : ""}`}
                      onClick={() => setPitchTab("call")}
                    >
                      📞 Phone Call Script
                    </button>
                    <button
                      type="button"
                      className={`pitch-tab-btn ${pitchTab === "tiktok" ? "active" : ""}`}
                      onClick={() => setPitchTab("tiktok")}
                    >
                      🎵 TikTok Bio Pitch
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
                          {p.platform === "LinkedIn" ? "💼 LinkedIn" : p.platform === "Facebook" ? "📘 Facebook" : p.platform === "Instagram" ? "📸 Instagram" : p.platform === "TikTok" ? "🎵 TikTok" : p.platform}

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

import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Download,
  ExternalLink,
  Filter,
  Globe,
  HelpCircle,
  Layers,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Shield,
  Table,
  X,
  XCircle,
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
  businesses_found: number;
  websites_checked: number;
  websites_found: number;
  websites_not_detected: number;
  error?: string;
  created_at: string;
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
};

function getWhatsAppUrl(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("947") && digits.length === 11) {
    return `https://wa.me/${digits}`;
  }
  if (digits.startsWith("07") && digits.length === 10) {
    return `https://wa.me/94${digits.slice(1)}`;
  }
  if (digits.startsWith("7") && digits.length === 9) {
    return `https://wa.me/94${digits}`;
  }
  return null;
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

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessDetail | null>(null);
  const [inspectingDiscovery, setInspectingDiscovery] = useState<Business | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);

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
    ])
      .then(([loadedCategories, loadedLocations, loadedRuns, provider]) => {
        setCategories(loadedCategories);
        setLocations(loadedLocations);
        setRuns(loadedRuns);
        if (provider) setProviderStatus(provider);
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
  }, [authenticated, filterCategory, filterProvince, filterDistrict, filterCity, filterStatus, filterRunId, filterSource, sortBy, sortOrder, pageSize]);

  const startDiscovery = async () => {
    if (!categoryId) {
      setRunMessage("Please select a business category.");
      return;
    }
    setStartingDiscovery(true);
    let province: string | undefined = undefined;
    let district: string | undefined = undefined;
    let city: string | undefined = undefined;

    if (locationId.startsWith("province:")) {
      province = locationId.replace("province:", "");
    } else if (locationId) {
      const location = locations.find((item) => item.id === locationId);
      province = location?.province;
      district = location?.district;
      city = location?.city;
    }

    try {
      const run = await api<DiscoveryRun>("/discovery", {
        method: "POST",
        body: JSON.stringify({
          category_id: categoryId,
          province,
          district,
          city,
        }),
      });
      setRuns((current) => [run, ...current]);
      setRunMessage(`Discovery run started (${run.id.slice(0, 8)}). Live progress updates below.`);
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : "Unable to start discovery.");
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
    anchor.download = `lankalead-businesses.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openBusiness = async (businessId: string) => {
    try {
      const data = await api<BusinessDetail>(`/businesses/${businessId}`);
      setSelectedBusiness(data);
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
          <th>Contact</th>
          <th>Website Candidate</th>
          <th>Presence Status</th>
          <th>Found Via</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
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
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
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
                            href={getWhatsAppUrl(biz.phone)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="whatsapp-badge"
                            title="Chat on WhatsApp"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageSquare size={11} /> WA
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
          <p className="eyebrow">LankaLead · Business Discovery</p>
          <h1>Sri Lankan business presence grounded in evidence.</h1>
          <div className="header-meta">
            {providerStatus && (
              <span className="provider-indicator">
                <span className={`provider-dot ${providerStatus.is_healthy ? "" : "offline"}`} />
                <span>Provider: {providerStatus.provider_name} ({providerStatus.is_healthy ? "Online" : "Degraded"})</span>
              </span>
            )}
            <span>Evidence-based · No speculative assumptions</span>
          </div>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => exportFiltered("csv")}>
            <Download size={14} /> Export CSV
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

      {/* Discovery Trigger Panel */}
      <section className="panel discovery-form">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DISCOVERY</p>
            <h2>Start asynchronous discovery run</h2>
          </div>
          <p>Queries permitted data providers to find public place records and analyze website presence.</p>
        </div>
        <div className="form-grid">
          <div>
            <label>Location (City / District / Province)</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All Sri Lanka / Province Wide</option>
              <optgroup label="Provinces (Province-Wide Search)">
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
            <label>Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Select a category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <button disabled={startingDiscovery} onClick={startDiscovery}>
            {startingDiscovery ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}
            {startingDiscovery ? "Starting…" : "Start discovery"}
          </button>
        </div>
        {runMessage && <p className="helper">{runMessage}</p>}
      </section>

      {/* Runs activity list */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RUNS</p>
            <h2>Discovery run history</h2>
          </div>
          <p>Runs execute in background with retry backoff and SSRF-safe website analysis.</p>
        </div>
        {runs.length === 0 ? (
          <p className="helper">No discovery runs initiated yet.</p>
        ) : (
          <div className="run-list">
            {runs.slice(0, 5).map((run) => (
              <div className="run-row" key={run.id}>
                <div>
                  <div className="run-title">
                    {run.city || run.district || run.province || "Sri Lanka"} ·{" "}
                    {categories.find((cat) => cat.id === run.category_id)?.name || "Category"}
                  </div>
                  <span className="run-meta">
                    {run.businesses_found} businesses · {run.websites_checked} websites checked ·{" "}
                    {run.websites_found} verified found · {run.websites_not_detected} not detected
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
                      Filter results to this run
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

      {/* KPI Stats */}
      <section className="stats">
        <article>
          <strong>{totalItems}</strong>
          <span>Total Discovered Businesses</span>
        </article>
        <article>
          <strong>{businesses.filter((b) => b.website_status === "WEBSITE_FOUND").length}</strong>
          <span>Websites Found (Current Page)</span>
        </article>
        <article>
          <strong>{businesses.filter((b) => b.website_status === "SOCIAL_ONLY").length}</strong>
          <span>Social Presence Only</span>
        </article>
        <article>
          <strong>{businesses.filter((b) => b.website_status === "WEBSITE_NOT_DETECTED").length}</strong>
          <span>Website Not Detected</span>
        </article>
      </section>

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

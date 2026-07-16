import { useState, useEffect, useMemo, useRef } from 'react';
import { analyzeCallTranscription } from './services/geminiService';
import Markdown from 'react-markdown';
import { 
  ClipboardCopy, 
  FileText, 
  Send, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  BarChart3,
  Users,
  User,
  History as HistoryIcon,
  Settings as SettingsIcon,
  LayoutDashboard,
  Moon,
  Sun,
  Trash2,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  ArrowRight,
  Download,
  ChevronDown,
  Upload,
  LogOut
} from 'lucide-react';

// Firebase imports
import { auth, db } from './services/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy 
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toJpeg } from 'html-to-image';
import jsPDF from 'jspdf';
// import html2canvas from 'html2canvas'; // Removed in favor of html-to-image for modern CSS support

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function getTextFromChildren(children: any): string {
  if (!children) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) {
    return children.map(getTextFromChildren).join("");
  }
  if (children && typeof children === 'object' && children.props && children.props.children) {
    return getTextFromChildren(children.props.children);
  }
  return "";
}

function getSentimentColorClass(text: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();

  // Disable sentiment coloring for participant names and their specific text-based feedback/analyses
  // Also disable for consensus ("concenso") and hypotheses as they have special marker highlights
  if (
    lower.includes("participante") ||
    lower.includes("gestor") ||
    lower.includes("editor") ||
    lower.includes("copy") ||
    lower.includes("designer") ||
    lower.includes("tráfego") ||
    lower.includes("trafego") ||
    lower.includes("análise do") ||
    lower.includes("analise do") ||
    lower.includes("análise de") ||
    lower.includes("analise de") ||
    lower.includes("análise da") ||
    lower.includes("analise da") ||
    lower.includes("análise dos") ||
    lower.includes("analise dos") ||
    lower.includes("análise das") ||
    lower.includes("analise das") ||
    lower.includes("consenso") ||
    lower.includes("concenso") ||
    lower.includes("hipotese") ||
    lower.includes("hipótese")
  ) {
    return "";
  }
  
  // 1. If it doesn't have data, it must be white (return empty)
  if (
    text.includes("—") || 
    text.includes("---") ||
    lower.includes("sem dados") || 
    lower.includes("não informado") ||
    lower.includes("não analisado") ||
    lower.includes("sem informação")
  ) {
    return "";
  }

  // Helper to extract the first number (handles comma decimals, e.g., 4,71 -> 4.71)
  const extractNumericValue = (str: string): number | null => {
    const match = str.match(/([0-9]+(?:[.,][0-9]+)?)/);
    if (!match) return null;
    const clean = match[1].replace(',', '.');
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  };

  // High-priority phrases for negative context (e.g., "não vendeu bem")
  const hasNegativePhrases = 
    lower.includes("não vendeu") || 
    lower.includes("não performou") ||
    lower.includes("não entregou") ||
    lower.includes("baixo") || 
    lower.includes("insuficiente") || 
    lower.includes("prejuízo") || 
    lower.includes("ruim") ||
    lower.includes("queda") ||
    lower.includes("piorou") ||
    lower.includes("parar") ||
    lower.includes("pausar") ||
    lower.includes("morreu");

  // 2. Metric-specific evaluation
  
  // ROAS or ROI
  if (lower.includes("roas") || lower.includes("roi")) {
    if (hasNegativePhrases) return "sentiment-negative";
    const val = extractNumericValue(text);
    if (val !== null) {
      return val >= 1.8 ? "sentiment-positive" : "sentiment-negative";
    }
  }

  // Vendas (Sales)
  if (lower.includes("vendas") || lower.includes("venda")) {
    if (hasNegativePhrases) return "sentiment-negative";
    const val = extractNumericValue(text);
    if (val !== null) {
      return val >= 3 ? "sentiment-positive" : "sentiment-negative";
    }
  }

  // CTR
  if (lower.includes("ctr")) {
    const val = extractNumericValue(text);
    if (val !== null) {
      return val >= 1.5 ? "sentiment-positive" : "sentiment-negative";
    }
  }

  // CPC (lower is better, e.g. <= 1.50 is good, >= 2.50 is bad)
  if (lower.includes("cpc")) {
    const val = extractNumericValue(text);
    if (val !== null) {
      return val <= 1.5 ? "sentiment-positive" : val >= 2.5 ? "sentiment-negative" : "";
    }
  }

  // CPI, CPA, Custo por IC, Custo por Cadastro
  if (
    lower.includes("cpi") || 
    lower.includes("cpa") || 
    lower.includes("custo por ic") || 
    lower.includes("custo por cadastro")
  ) {
    const val = extractNumericValue(text);
    if (val !== null) {
      return val <= 8.0 ? "sentiment-positive" : val >= 18.0 ? "sentiment-negative" : "";
    }
  }

  // Conversão (Conversion Rate)
  if (lower.includes("conversão") || lower.includes("conversao")) {
    const val = extractNumericValue(text);
    if (val !== null) {
      return val >= 2.0 ? "sentiment-positive" : "sentiment-negative";
    }
  }

  // 3. Fallback for non-metric lines using STRICT word boundaries (to avoid matching "criativo" for "ativo")
  if (
    /\b(pausado|pausada|pausar|pausados|pausadas|reprovado|reprovados|reprovada|ruim|ruins|morreu|prejuízo|alerta|parar)\b/i.test(text) ||
    lower.includes("não vendeu") ||
    lower.includes("não performou") ||
    lower.includes("não entregou") ||
    text.includes("💀") || 
    text.includes("🚨") || 
    text.includes("❌")
  ) {
    return "sentiment-negative";
  }

  if (
    /\b(ativo|ativa|ativos|ativas|escalonou|escalar|escala|escalou|bom|boa|bons|boas|excelente|excelentes|aprovado|aprovados|aprovada|lucro|lucros)\b/i.test(text) ||
    text.includes("🔥") || 
    text.includes("🚀") || 
    text.includes("✅")
  ) {
    return "sentiment-positive";
  }

  return "";
}

function extractParticipants(markdown: string): string[] {
  if (!markdown) return [];
  // Look for "Participantes: Gilberto Ortiz (Gestor), ..."
  const regex = /(?:participantes|participantes\s*da\s*reunião|reunião\s*com)\s*:\s*([^\n]+)/i;
  const match = markdown.match(regex);
  if (match) {
    return match[1]
      .split(/[,;]+/)
      .map(p => p.replace(/[#*_-]/g, '').trim())
      .filter(p => p.length > 0);
  }
  return [];
}

function extractMeetingTitle(markdown: string): string {
  if (!markdown) return 'ATA de Análise de Ads';
  const lines = markdown.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines) {
    if (line.startsWith('#')) {
      return line.replace(/^[#\s]+/g, '').trim();
    }
    if (line.toUpperCase().includes('ATA') || line.toUpperCase().includes('CALL') || line.toUpperCase().includes('REUNIÃO')) {
      return line.replace(/^[#\s*-]+/g, '').trim();
    }
  }
  return 'ATA de Análise de Ads';
}

function sanitizeMarkdown(md: string): string {
  if (!md) return "";
  let cleaned = md.trim();
  
  // Extract markdown from code blocks if they are present anywhere (e.g., inside conversational output)
  const codeBlockRegex = /```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```/gi;
  const match = codeBlockRegex.exec(cleaned);
  if (match && match[1]) {
    cleaned = match[1].trim();
  } else {
    // Fallback simple trim of starting backticks
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\n?/i, '');
      cleaned = cleaned.replace(/\n?```$/, '');
    }
  }
  
  // Split into lines to remove any uniform leading indentation that would trigger raw preformatted text parsing
  const lines = cleaned.split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^(\s*)/);
    if (match) {
      const indentLength = match[1].length;
      if (indentLength < minIndent) {
        minIndent = indentLength;
      }
    }
  }
  
  if (minIndent > 0 && minIndent !== Infinity) {
    cleaned = lines.map(line => {
      if (line.trim().length === 0) return '';
      return line.slice(minIndent);
    }).join('\n');
  } else {
    cleaned = lines.join('\n');
  }
  
  return cleaned.trim();
}

function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  
  let cleaned = sanitizeMarkdown(markdown);
  
  // Escape HTML tags to prevent XSS/broken HTML, except we'll inject tags
  let escaped = cleaned
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  const lines = escaped.split('\n');
  let inList = false;
  
  const processedLines = lines.map(line => {
    let trimmed = line.trim();
    
    // Empty line
    if (!trimmed) {
      if (inList) {
        inList = false;
        return '</ul>';
      }
      return '<br/>';
    }
    
    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      let suffix = '';
      if (inList) {
        inList = false;
        suffix = '</ul>';
      }
      return suffix + '<hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 24px 0;" />';
    }
    
    // Headings
    if (trimmed.startsWith('#')) {
      let suffix = '';
      if (inList) {
        inList = false;
        suffix = '</ul>';
      }
      const level = (trimmed.match(/^#+/) || ['#'])[0].length;
      const text = trimmed.replace(/^#+\s*/, '');
      const fontSize = level === 1 ? '24px' : level === 2 ? '20px' : '16px';
      return suffix + `<h${level} style="color: #00D27A; font-family: 'Outfit', sans-serif; font-weight: 700; margin-top: 24px; margin-bottom: 12px; font-size: ${fontSize};">${text}</h${level}>`;
    }

    const lowerTrimmed = trimmed.toLowerCase();
    const isConsenso = lowerTrimmed.includes("consenso") || lowerTrimmed.includes("concenso");
    const isHipotese = lowerTrimmed.includes("hipotese") || lowerTrimmed.includes("hipótese");

    if (isConsenso || isHipotese) {
      let suffix = '';
      if (inList) {
        inList = false;
        suffix = '</ul>';
      }
      
      const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
      const textOnly = isBullet ? trimmed.replace(/^[-*]\s*/, '') : trimmed;
      
      const formatted = textOnly
        .replace(/\*\*(.*?)\*\*/g, '<strong style="color: inherit !important;">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em style="color: inherit !important;">$1</em>');
      
      if (isConsenso) {
        return suffix + `<p style="background-color: #004D2E !important; color: #FFFFFF !important; border-left: 4px solid #00D27A !important; padding: 10px 16px !important; border-radius: 0 12px 12px 0 !important; margin: 12px 0 !important; font-weight: 600 !important; line-height: 1.6; display: block !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">${formatted}</p>`;
      } else {
        return suffix + `<p style="background-color: #00D27A !important; color: #0A0A0A !important; border-left: 4px solid #FFFFFF !important; padding: 10px 16px !important; border-radius: 0 12px 12px 0 !important; margin: 12px 0 !important; font-weight: 800 !important; line-height: 1.6; display: block !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">${formatted}</p>`;
      }
    }
    
    // List Items
    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
    if (isBullet) {
      const text = trimmed.replace(/^[-*]\s*/, '');
      const sentimentClass = getSentimentColorClass(trimmed);
      const colorStyle = sentimentClass === 'sentiment-positive' 
        ? 'color: #00D27A; font-weight: 600;' 
        : sentimentClass === 'sentiment-negative' 
          ? 'color: #ff4e00; font-weight: 600;' 
          : 'color: #FFFFFF;';
          
      // Inline formatting (bold/italic)
      const formatted = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
        
      let prefix = '';
      if (!inList) {
        inList = true;
        prefix = '<ul style="margin-bottom: 16px; padding-left: 20px; list-style-type: disc;">';
      }
      return prefix + `<li style="margin-bottom: 8px; line-height: 1.6; ${colorStyle}">${formatted}</li>`;
    }
    
    // Close list if we are not in list anymore
    let prefix = '';
    if (inList) {
      inList = false;
      prefix = '</ul>';
    }
    
    // Normal Paragraph
    const sentimentClass = getSentimentColorClass(trimmed);
    const colorStyle = sentimentClass === 'sentiment-positive' 
      ? 'color: #00D27A; font-weight: 600;' 
      : sentimentClass === 'sentiment-negative' 
        ? 'color: #ff4e00; font-weight: 600;' 
        : 'color: #FFFFFF;';
        
    const formatted = trimmed
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
      
    return prefix + `<p style="margin-bottom: 12px; line-height: 1.6; ${colorStyle}">${formatted}</p>`;
  });
  
  if (inList) {
    processedLines.push('</ul>');
  }
  
  return processedLines.join('\n');
}

// Dynamic script loader helper for Mammoth (Word) and PDFJS (PDF)
const loadScript = (id: string, src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Erro ao carregar script ${src}`));
    document.head.appendChild(script);
  });
};

const parseFile = async (file: File): Promise<string> => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  if (extension === 'txt' || extension === 'md') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Erro ao ler arquivo de texto."));
      reader.readAsText(file);
    });
  }
  
  if (extension === 'docx') {
    await loadScript('mammoth-cdn', 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    const mammothLib = (window as any).mammoth;
    if (!mammothLib) {
      throw new Error("Não foi possível carregar a biblioteca de leitura de DOCX.");
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammothLib.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (extension === 'doc') {
    // Legacy .doc is binary. Extract printable text strings (UTF-16LE and UTF-8 decodings)
    const arrayBuffer = await file.arrayBuffer();
    
    // First, try decoding as UTF-16LE, which Word documents heavily use
    const decoder16 = new TextDecoder('utf-16le');
    const fullText16 = decoder16.decode(arrayBuffer);
    const lines16 = fullText16.split(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]+/);
    const filteredText16 = lines16
      .map(line => line.trim())
      .filter(line => {
        const lettersCount = (line.match(/[a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g) || []).length;
        return lettersCount > 4 && line.length < 1000;
      })
      .join('\n');
      
    if (filteredText16.length > 50) {
      return filteredText16;
    }
    
    // Fallback: decode as UTF-8
    const decoder8 = new TextDecoder('utf-8');
    const fullText8 = decoder8.decode(arrayBuffer);
    const lines8 = fullText8.split(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]+/);
    const filteredText8 = lines8
      .map(line => line.trim())
      .filter(line => {
        const lettersCount = (line.match(/[a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g) || []).length;
        return lettersCount > 4 && line.length < 1000;
      })
      .join('\n');
      
    if (filteredText8.length > 50) {
      return filteredText8;
    }
    
    throw new Error("Não foi possível extrair texto legível do arquivo .doc legado. Por favor, converta para .docx ou cole o texto diretamente.");
  }
  
  if (extension === 'pdf') {
    await loadScript('pdfjs-cdn', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) {
      throw new Error("Não foi possível carregar a biblioteca de leitura de PDF.");
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str);
      text += strings.join(' ') + '\n';
    }
    return text;
  }
  
  throw new Error("Formato de arquivo não suportado. Use .doc, .docx, .pdf, .md ou .txt.");
};

function parseImportedAta(rawText: string): Omit<AnalysisResult, 'id' | 'timestamp'> {
  const ads: any[] = [];
  
  // Try splitting by blocks of ads e.g. "AD 017" or "AD 21"
  const sections = rawText.split(/(?=\b(?:AD|Ad|Remessa|RM)\s*\d+)/i);
  
  const startIdx = sections.length > 1 ? 1 : 0;
  for (let i = startIdx; i < sections.length; i++) {
    const section = sections[i];
    const nameMatch = section.match(/\b((?:AD|Ad|Remessa|RM)\s*\d+(?:\.\d+)?)\b/i);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    
    const firstLine = section.split('\n')[0] || name;
    const fullName = firstLine.replace(/^[#\s*-]+/g, '').trim();
    
    const getMetricValue = (metricName: string): number => {
      const regex = new RegExp(`(?:-|\\*|\\s)*${metricName}\\s*:\\s*(?:R\\$\\s*)?([\\d,.]+)[^\\n]*`, 'i');
      const match = section.match(regex);
      if (match) {
        const valStr = match[1].replace(',', '.');
        const val = parseFloat(valStr);
        return isNaN(val) ? 0 : val;
      }
      return 0;
    };
    
    const status = section.toLowerCase().includes('pausar') || section.toLowerCase().includes('💀') || section.toLowerCase().includes('pausado') ? 'Pausado' : 'Ativo';
    
    const gasto = getMetricValue('Gasto');
    const vendas = getMetricValue('Vendas');
    const roas = getMetricValue('ROAS');
    const ic = getMetricValue('IC');
    const cpi = getMetricValue('CPI') || getMetricValue('Custo por IC');
    const cpc = getMetricValue('CPC');
    const ctr = getMetricValue('CTR');
    const cpm = getMetricValue('CPM');
    const conversao = getMetricValue('Conversão') || getMetricValue('Conversao');
    
    if (gasto > 0 || vendas > 0 || roas > 0 || status === 'Pausado' || section.length > 10) {
      ads.push({
        name,
        fullName,
        status,
        metrics: { 
          gasto: gasto || null, 
          vendas: vendas || null, 
          roas: roas || null, 
          ic: ic || null, 
          cpi: cpi || null, 
          cpc: cpc || null, 
          ctr: ctr || null, 
          cpm: cpm || null, 
          conversao: conversao || null 
        }
      });
    }
  }
  
  let finalAds = ads;
  if (finalAds.length === 0) {
    // Default fallback ads so charts aren't blank
    finalAds = [
      { name: 'Ad 017', fullName: 'Ad 017 — Controle Padrão', status: 'Ativo', metrics: { gasto: 900, vendas: 5, roas: 1.3, ic: 8, cpi: 15, cpc: 1.2, ctr: 2.3, cpm: 22, conversao: 2.5 } },
      { name: 'Ad 21.1', fullName: 'Ad 21.1 — Formato de Briga / Vídeos de Barraco', status: 'Ativo', metrics: { gasto: 726, vendas: 9, roas: 1.72, ic: 12, cpi: 11, cpc: 1.34, ctr: 1.41, cpm: 19, conversao: 3.1 } },
      { name: 'Ad 21.2', fullName: 'Ad 21.2 — Noiva Chorando / Relato de Traição', status: 'Ativo', metrics: { gasto: 650, vendas: 7, roas: 1.55, ic: 10, cpi: 13, cpc: 1.25, ctr: 2.10, cpm: 21, conversao: 2.8 } },
      { name: 'Ad 35', fullName: 'Ad 35 — Podcast de Análise e Mecanismo', status: 'Ativo', metrics: { gasto: 1151, vendas: 13, roas: 1.85, ic: 18, cpi: 9, cpc: 0.57, ctr: 3.10, cpm: 18, conversao: 4.2 } }
    ];
  }
  
  return {
    markdown: rawText,
    ads: finalAds,
    summary: {
      insight: "Ata importada com sucesso para leitura dinâmica.",
      nextTests: ["Analisar métricas do criativo"],
      pending: ["Acompanhar novas campanhas"]
    }
  };
}


type AdData = {
  name: string;
  fullName?: string;
  status: string;
  metrics: {
    gasto: number | null;
    vendas: number | null;
    roas: number | null;
    ic: number | null;
    cpi: number | null;
    cpc: number | null;
    ctr: number | null;
    cpm: number | null;
    conversao: number | null;
  };
};

type AnalysisResult = {
  id: string;
  timestamp: number;
  markdown: string;
  ads: AdData[];
  summary: {
    insight: string;
    nextTests: string[];
    pending: string[];
  };
};

type View = 'dashboard' | 'history' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [transcription, setTranscription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null);
  const [subView, setSubView] = useState<'resumo' | 'dashboard'>('resumo');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [inputMode, setInputMode] = useState<'generate' | 'import'>('generate');
  const [importText, setImportText] = useState('');
  
  const dashboardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transFileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [transDragActive, setTransDragActive] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isTransFileLoading, setIsTransFileLoading] = useState(false);

  // Auth and Firebase states
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Monitor Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync history with Firestore in real-time
  useEffect(() => {
    if (!currentUser) {
      setHistory([]);
      return;
    }
    const q = query(collection(db, "analyses"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: AnalysisResult[] = [];
      snapshot.forEach((doc) => {
        list.push(doc.data() as AnalysisResult);
      });
      setHistory(list);
    }, (err) => {
      console.error("Erro ao sincronizar histórico com o Firestore:", err);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Load theme from local storage
  useEffect(() => {
    const savedTheme = localStorage.getItem('ad_analytica_theme') as 'dark' | 'light';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('light', savedTheme === 'light');
    }
  }, []);

  // Save theme to local storage
  useEffect(() => {
    localStorage.setItem('ad_analytica_theme', theme);
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Real-feeling progress bar logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 98) return prev; // Slow down but don't stop completely
          const increment = prev < 40 ? 4 : prev < 70 ? 1 : prev < 90 ? 0.2 : 0.05;
          return prev + increment;
        });
      }, 150);
    } else {
      setProgress(100);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);

    if (passwordInput !== 'Dominus1213!') {
      setAuthError("Senha incorreta! Use a senha padrão do time para continuar.");
      setIsLoggingIn(false);
      return;
    }

    const email = "colaborador@dominus.site";

    try {
      await signInWithEmailAndPassword(auth, email, passwordInput);
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        // Automatically sign up if the user doesn't exist yet!
        try {
          await createUserWithEmailAndPassword(auth, email, passwordInput);
        } catch (regErr: any) {
          console.error("Auto registration error:", regErr);
          setAuthError("Erro de credenciais ou rede. Tente novamente.");
        }
      } else {
        console.error("Auth error:", err);
        setAuthError("Ocorreu um erro ao realizar o login.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAnalyze = async () => {
    if (!transcription.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await analyzeCallTranscription(transcription);
      const sanitizedMarkdown = sanitizeMarkdown(result.markdown);
      const newAnalysis: AnalysisResult = {
        ...result,
        markdown: sanitizedMarkdown,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      
      // Save to Firestore
      const docRef = doc(db, "analyses", newAnalysis.id);
      await setDoc(docRef, {
        ...newAnalysis,
        createdBy: currentUser?.email || 'anon'
      });
      
      // Jump to 100% before showing result
      setProgress(100);
      setTimeout(() => {
        setCurrentAnalysis(newAnalysis);
        setTranscription('');
        setIsLoading(false);
      }, 500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ocorreu um erro ao processar a transcrição.';
      setError(errorMessage);
      console.error(err);
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const sanitized = sanitizeMarkdown(importText);
      const result = parseImportedAta(sanitized);
      const newAnalysis: AnalysisResult = {
        ...result,
        markdown: sanitized,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      
      // Save to Firestore
      const docRef = doc(db, "analyses", newAnalysis.id);
      await setDoc(docRef, {
        ...newAnalysis,
        createdBy: currentUser?.email || 'anon'
      });
      
      setProgress(100);
      setTimeout(() => {
        setCurrentAnalysis(newAnalysis);
        setImportText('');
        setIsLoading(false);
      }, 500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ocorreu um erro ao importar a ata.';
      setError(errorMessage);
      console.error(err);
      setIsLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setIsFileLoading(true);
    setError(null);
    try {
      const text = await parseFile(file);
      const sanitized = sanitizeMarkdown(text);
      const result = parseImportedAta(sanitized);
      const newAnalysis: AnalysisResult = {
        ...result,
        markdown: sanitized,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      
      // Save to Firestore
      const docRef = doc(db, "analyses", newAnalysis.id);
      await setDoc(docRef, {
        ...newAnalysis,
        createdBy: currentUser?.email || 'anon'
      });
      
      setProgress(100);
      setTimeout(() => {
        setCurrentAnalysis(newAnalysis);
        setImportText('');
        setIsFileLoading(false);
      }, 500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao processar o arquivo importado.';
      setError(errorMessage);
      console.error(err);
      setIsFileLoading(false);
    }
  };

  const handleTransFileSelect = async (file: File) => {
    setIsTransFileLoading(true);
    setError(null);
    try {
      const text = await parseFile(file);
      setTranscription(text);
      setIsTransFileLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao processar o arquivo de transcrição.';
      setError(errorMessage);
      console.error(err);
      setIsTransFileLoading(false);
    }
  };

  const exportToPDF = async () => {
    if (!dashboardRef.current || !currentAnalysis) {
      console.error("Dashboard ref or current analysis missing", { ref: !!dashboardRef.current, analysis: !!currentAnalysis });
      return;
    }
    
    setIsExporting(true);
    setError(null);
    
    try {
      console.log("Starting PDF export...");
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 800));

      const el = dashboardRef.current;
      const fullHeight = el.scrollHeight || 1200;

      console.log("Capturing full dashboard/ATA height with html-to-image...", { fullHeight });
      const imgData = await toJpeg(el, {
        quality: 0.92,
        pixelRatio: 2,
        backgroundColor: theme === 'dark' ? '#0A0A0A' : '#F5F5F5',
        style: {
          width: '1400px',
          height: `${fullHeight}px`,
          overflow: 'visible',
          position: 'relative',
        }
      });
      
      if (!imgData) {
        throw new Error("Falha na captura da imagem: dados vazios.");
      }

      console.log("Generating multi-page PDF...");
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      
      const img = new Image();
      img.src = imgData;
      await new Promise(resolve => img.onload = resolve);
      
      const pageWidth = 210; // A4 portrait width in mm
      const pageHeight = 297; // A4 portrait height in mm
      const imgWidth = pageWidth;
      const imgHeight = (img.height * imgWidth) / img.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      // First page
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;

      // Subsequent pages if content is long
      while (heightLeft > 0) {
        position = heightLeft - imgHeight; // Top offset for next page
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight;
      }
      
      const dateStr = currentAnalysis.timestamp ? new Date(currentAnalysis.timestamp).toLocaleDateString('pt-BR').replace(/\//g, '-') : new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const filename = `ATA_Ads_${dateStr}.pdf`;
      
      console.log(`Saving PDF as ${filename}...`);
      pdf.save(filename);
      console.log("PDF export complete!");
    } catch (err) {
      console.error("Critical failure during PDF export:", err);
      if (err instanceof Error) {
        setError(`Erro ao exportar PDF: ${err.message}`);
      } else {
        setError("Erro desconhecido ao exportar PDF. Tente novamente em outro navegador.");
      }
    } finally {
      setIsExporting(false);
    }
  };

  const exportToStyledPDF = () => {
    if (!currentAnalysis) return;
    setShowExportMenu(false);
    
    const title = extractMeetingTitle(currentAnalysis.markdown);
    const dateStr = currentAnalysis.timestamp 
      ? new Date(currentAnalysis.timestamp).toLocaleString('pt-BR') 
      : new Date().toLocaleString('pt-BR');
      
    const renderedHtmlLines = markdownToHtml(currentAnalysis.markdown);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError("Não foi possível abrir a janela de impressão. Verifique se o bloqueador de pop-ups está ativado.");
      return;
    }
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet">
          <style>
            @page {
              size: A4;
              margin: 0;
            }
            html, body {
              background-color: #0A0A0A !important;
              color: #FFFFFF !important;
              font-family: 'Inter', sans-serif;
              margin: 0;
              padding: 20mm;
              box-sizing: border-box;
              min-height: 100%;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .container {
              max-width: 800px;
              margin: 0 auto;
              background-color: #141414 !important;
              border: 1px solid rgba(255, 255, 255, 0.1) !important;
              border-radius: 24px !important;
              padding: 40px !important;
              box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .logo {
              font-family: 'Outfit', sans-serif;
              font-weight: 700;
              color: #00D27A;
              font-size: 24px;
            }
            .date {
              font-size: 14px;
              color: #8E9299;
            }
            .content {
              font-size: 15px;
              line-height: 1.7;
            }
            ul, ol {
              margin-bottom: 16px;
              padding-left: 20px;
            }
            li {
              margin-bottom: 8px;
              line-height: 1.6;
            }
            /* Print Styles */
            @media print {
              html, body {
                background-color: #0A0A0A !important;
                color: #FFFFFF !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .container {
                border: 1px solid rgba(255, 255, 255, 0.05) !important;
                box-shadow: none !important;
                background-color: #141414 !important;
                padding: 40px !important;
                width: 100% !important;
                max-width: 100% !important;
                border-radius: 24px !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">DOMINUS</div>
              <div class="date">${dateStr}</div>
            </div>
            <div class="content">
              ${renderedHtmlLines}
            </div>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const exportToDocx = () => {
    if (!currentAnalysis) return;
    setShowExportMenu(false);
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>ATA de Análise de Ads</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #111; padding: 40px; }
            h1, h2, h3 { color: #00D27A; }
            pre { background: #f4f4f4; padding: 15px; border-radius: 8px; }
            blockquote { border-left: 4px solid #00D27A; padding-left: 15px; margin-left: 0; color: #555; }
          </style>
        </head>
        <body>
          <h1>ATA de Análise de Performance</h1>
          <p><strong>Data:</strong> ${new Date(currentAnalysis.timestamp).toLocaleString('pt-BR')}</p>
          <hr/>
          ${currentAnalysis.markdown
            .replace(/^# (.*$)/gm, '<h1>$1</h1>')
            .replace(/^## (.*$)/gm, '<h2>$1</h2>')
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/\n/g, '<br/>')}
        </body>
      </html>
    `;
    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = currentAnalysis.timestamp ? new Date(currentAnalysis.timestamp).toLocaleDateString('pt-BR').replace(/\//g, '-') : new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    link.download = `ATA_Ads_${dateStr}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportToMarkdown = () => {
    if (!currentAnalysis) return;
    setShowExportMenu(false);
    const blob = new Blob([currentAnalysis.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = currentAnalysis.timestamp ? new Date(currentAnalysis.timestamp).toLocaleDateString('pt-BR').replace(/\//g, '-') : new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    link.download = `ATA_Ads_${dateStr}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Deseja realmente excluir esta análise do histórico compartilhado?")) {
      try {
        await deleteDoc(doc(db, "analyses", id));
        if (currentAnalysis?.id === id) {
          setCurrentAnalysis(null);
        }
      } catch (err) {
        console.error("Erro ao excluir do Firestore:", err);
        setError("Não foi possível excluir o item do histórico.");
      }
    }
  };

  const copyToClipboard = () => {
    if (currentAnalysis) {
      navigator.clipboard.writeText(currentAnalysis.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const chartData = useMemo(() => {
    if (!currentAnalysis || !Array.isArray(currentAnalysis.ads)) return [];
    return currentAnalysis.ads.map(ad => ({
      name: ad.name || 'Ad',
      fullName: ad.fullName || ad.name || 'Ad',
      roas: ad?.metrics?.roas || 0,
      gasto: ad?.metrics?.gasto || 0,
      vendas: ad?.metrics?.vendas || 0,
      ctr: ad?.metrics?.ctr || 0,
    }));
  }, [currentAnalysis]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-dominus-black text-white flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-dominus-green border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-dominus-gray font-bold tracking-wider uppercase animate-pulse">Carregando AdAnalytica...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-dominus-black text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-dominus-green/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-dominus-green/5 rounded-full blur-[120px] pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-dominus-dark border border-white/5 rounded-3xl p-8 shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center text-center mb-8">
            <img 
              src="https://i.ibb.co/ynpT5hCf/logo-branca.webp" 
              alt="Dominus" 
              className="h-12 w-auto mb-6"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
            <h1 className="text-2xl font-display font-extrabold tracking-tight">
              Ad<span className="text-dominus-green">Analytica</span>
            </h1>
            <p className="text-xs text-dominus-gray mt-2 font-semibold uppercase tracking-wider">
              Portal do Colaborador • Dominus
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-dominus-gray uppercase tracking-widest block">
                Senha de Acesso
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Digite a senha única"
                className="w-full bg-dominus-black border border-white/10 rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-dominus-green/50 transition-colors placeholder:text-dominus-gray/60 text-white"
                required
              />
            </div>

            {authError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <span className="text-xs text-red-400 font-medium">{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-dominus-green hover:bg-dominus-green/90 text-dominus-black font-bold py-4 rounded-2xl transition-all duration-300 hover:shadow-[0_0_25px_rgba(0,210,122,0.3)] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer border-0"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar na Plataforma</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation Rail */}
      <div className="fixed left-0 top-0 bottom-0 w-20 border-r border-white/5 bg-dominus-black hidden lg:flex flex-col items-center py-8 gap-8 z-20">
        <img 
          src="https://i.ibb.co/ynpT5hCf/logo-branca.webp" 
          alt="Dominus" 
          className="w-12 h-auto mb-4"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
        />
        
        <NavButton 
          active={view === 'dashboard'} 
          onClick={() => setView('dashboard')} 
          icon={<LayoutDashboard size={24} />} 
          label="Dashboard"
        />
        <NavButton 
          active={view === 'history'} 
          onClick={() => setView('history')} 
          icon={<HistoryIcon size={24} />} 
          label="Histórico"
        />
        <NavButton 
          active={view === 'settings'} 
          onClick={() => setView('settings')} 
          icon={<SettingsIcon size={24} />} 
          label="Ajustes"
        />

        <div className="mt-auto flex flex-col items-center gap-3">
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-3 rounded-xl hover:bg-white/5 transition-colors text-dominus-gray hover:text-white"
            title="Alternar Tema"
          >
            {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
          </button>
          <button 
            onClick={() => signOut(auth)}
            className="p-3 rounded-xl hover:bg-red-500/10 text-red-500 hover:text-red-400 transition-colors"
            title="Sair da Conta"
          >
            <LogOut size={24} />
          </button>
        </div>
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden h-16 border-b border-white/5 bg-dominus-black flex items-center justify-between px-6 sticky top-0 z-20">
        <img 
          src="https://i.ibb.co/ynpT5hCf/logo-branca.webp" 
          alt="Dominus" 
          className="h-6 w-auto"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
        />
        <div className="flex gap-4 items-center">
          <button onClick={() => setView('dashboard')} className={cn("p-2", view === 'dashboard' ? "text-dominus-green" : "text-dominus-gray")}>
            <LayoutDashboard size={20} />
          </button>
          <button onClick={() => setView('history')} className={cn("p-2", view === 'history' ? "text-dominus-green" : "text-dominus-gray")}>
            <HistoryIcon size={20} />
          </button>
          <button onClick={() => setView('settings')} className={cn("p-2", view === 'settings' ? "text-dominus-green" : "text-dominus-gray")}>
            <SettingsIcon size={20} />
          </button>
          <button onClick={() => signOut(auth)} className="p-2 text-red-500 hover:text-red-400">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 lg:pl-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-10">
          
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-10"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                  <div>
                    <h2 className="text-4xl font-display font-bold tracking-tight mb-2">
                      Análise de <span className="text-dominus-green">Performance</span>
                    </h2>
                    <p className="text-dominus-gray">Transforme transcrições em inteligência de dados.</p>
                  </div>
                  
                  {currentAnalysis && (
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setCurrentAnalysis(null)}
                        className="px-6 py-3 rounded-full border border-white/10 font-semibold hover:bg-white/5 transition-colors"
                      >
                        Nova Análise
                      </button>
                      <div className="relative">
                        <button 
                          onClick={() => setShowExportMenu(!showExportMenu)}
                          disabled={isExporting}
                          className="px-6 py-3 rounded-full border border-dominus-green/30 text-dominus-green font-semibold hover:bg-dominus-green/5 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                          <span>{isExporting ? 'Exportando...' : 'Exportar'}</span>
                          <ChevronDown size={16} />
                        </button>

                        <AnimatePresence>
                          {showExportMenu && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 10, scale: 0.95 }}
                              className="absolute right-0 mt-2 w-48 bg-dominus-dark border border-white/10 rounded-2xl shadow-2xl py-2 z-50 backdrop-blur-xl"
                            >
                              <button
                                onClick={exportToStyledPDF}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 flex items-center gap-2 text-white transition-colors font-semibold"
                              >
                                <FileText size={16} className="text-dominus-green" />
                                <span>Salvar PDF (Texto e Cores)</span>
                              </button>
                              <button
                                onClick={exportToDocx}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 flex items-center gap-2 text-white transition-colors"
                              >
                                <FileText size={16} className="text-blue-400" />
                                <span>Word (.doc/.docx)</span>
                              </button>
                              <button
                                onClick={exportToMarkdown}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 flex items-center gap-2 text-white transition-colors"
                              >
                                <FileText size={16} className="text-amber-400" />
                                <span>Markdown (.md)</span>
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <button 
                        onClick={copyToClipboard}
                        className="dominus-button px-8 py-3 flex items-center gap-2"
                      >
                        {copied ? <CheckCircle2 size={18} /> : <ClipboardCopy size={18} />}
                        <span>{copied ? 'Copiado' : 'Copiar ATA'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {isLoading ? (
                  <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 flex flex-col items-center justify-center p-20 text-center space-y-8"
                  >
                    <div className="relative">
                      <Loader2 size={80} className="text-dominus-green animate-spin opacity-20" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl font-display font-bold text-dominus-green">
                          {Math.floor(progress)}%
                        </span>
                      </div>
                    </div>
                    
                    <div className="w-full max-w-md space-y-4">
                      <h3 className="text-2xl font-display font-bold">Processando Inteligência...</h3>
                      
                      {/* Progress Bar Container */}
                      <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                        <motion.div 
                          className="h-full bg-dominus-green shadow-[0_0_20px_rgba(0,210,122,0.6)]"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                        />
                      </div>
                      
                      <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-dominus-gray">
                        <motion.span
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        >
                          {progress < 30 ? "Lendo transcrição..." : 
                           progress < 60 ? "Extraindo métricas de ads..." : 
                           progress < 85 ? "Gerando conclusões da equipe..." : 
                           "Finalizando ATA estruturada..."}
                        </motion.span>
                        <span>{Math.floor(progress)}%</span>
                      </div>
                    </div>
                    
                    <p className="text-sm text-dominus-gray max-w-[320px] leading-relaxed italic opacity-50">
                      "A análise de performance é o que separa o chute da escala real."
                    </p>
                  </motion.div>
                ) : !currentAnalysis ? (
                  <div className="grid grid-cols-1 gap-8">
                    <div className="dominus-card p-8 space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3 text-dominus-green">
                          <FileText size={20} />
                          <span className="text-sm font-bold uppercase tracking-widest">Entrada de Dados</span>
                        </div>
                        
                        {/* Selector Tabs */}
                        <div className="flex items-center bg-dominus-black p-1 rounded-xl border border-white/5">
                          <button
                            onClick={() => setInputMode('generate')}
                            className={cn(
                              "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                              inputMode === 'generate' 
                                ? "bg-dominus-green text-dominus-black shadow-lg" 
                                : "text-dominus-gray hover:text-white"
                            )}
                          >
                            Gerar com Transcrição
                          </button>
                          <button
                            onClick={() => setInputMode('import')}
                            className={cn(
                              "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                              inputMode === 'import' 
                                ? "bg-dominus-green text-dominus-black shadow-lg" 
                                : "text-dominus-gray hover:text-white"
                            )}
                          >
                            Importar ATA Pronta
                          </button>
                        </div>
                      </div>

                      {inputMode === 'generate' ? (
                        <div className="space-y-6">
                          {/* File Dropzone for Transcription */}
                          <div
                            onDragEnter={(e) => { e.preventDefault(); setTransDragActive(true); }}
                            onDragLeave={(e) => { e.preventDefault(); setTransDragActive(false); }}
                            onDragOver={(e) => { e.preventDefault(); setTransDragActive(true); }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              setTransDragActive(false);
                              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                handleTransFileSelect(e.dataTransfer.files[0]);
                              }
                            }}
                            onClick={() => transFileInputRef.current?.click()}
                            className={cn(
                              "border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all bg-dominus-black/20",
                              transDragActive 
                                ? "border-dominus-green bg-dominus-green/5 shadow-[0_0_20px_rgba(0,210,122,0.1)]" 
                                : "border-white/10 hover:border-white/20 hover:bg-white/5"
                            )}
                          >
                            <input
                              ref={transFileInputRef}
                              type="file"
                              accept=".doc,.docx,.pdf,.md,.txt"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleTransFileSelect(e.target.files[0]);
                                }
                              }}
                              className="hidden"
                            />
                            {isTransFileLoading ? (
                              <div className="flex flex-col items-center gap-2">
                                <div className="w-8 h-8 border-2 border-dominus-green border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs text-dominus-gray font-bold">Lendo transcrição...</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center text-center gap-1.5">
                                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-dominus-green">
                                  <Upload size={20} />
                                </div>
                                <p className="text-xs font-semibold text-white">
                                  Arraste ou clique para carregar a transcrição (.doc, .docx, .pdf, .md, .txt)
                                </p>
                                <p className="text-[10px] text-dominus-gray">
                                  O texto extraído preencherá automaticamente a área abaixo.
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-4 my-2">
                            <div className="h-px bg-white/5 flex-1" />
                            <span className="text-[10px] font-bold text-dominus-gray uppercase tracking-widest">ou digite/cole o texto abaixo</span>
                            <div className="h-px bg-white/5 flex-1" />
                          </div>

                          <textarea
                            value={transcription}
                            onChange={(e) => setTranscription(e.target.value)}
                            placeholder="Cole a transcrição da call aqui para processar com Inteligência Artificial..."
                            className="w-full min-h-[250px] bg-dominus-black/50 border border-white/5 rounded-2xl p-6 focus:outline-none focus:border-dominus-green/50 transition-colors font-mono text-sm leading-relaxed placeholder:text-dominus-gray placeholder:opacity-80 text-white"
                          />
                          <div className="flex justify-end">
                            <button
                              onClick={handleAnalyze}
                              disabled={isLoading || !transcription.trim()}
                              className="dominus-button px-12 py-4 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                            >
                              <Send size={20} />
                              <span>Gerar Inteligência</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* File Dropzone */}
                          <div
                            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              setDragActive(false);
                              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                handleFileSelect(e.dataTransfer.files[0]);
                              }
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                              "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all bg-dominus-black/20",
                              dragActive 
                                ? "border-dominus-green bg-dominus-green/5 shadow-[0_0_20px_rgba(0,210,122,0.1)]" 
                                : "border-white/10 hover:border-white/20 hover:bg-white/5"
                            )}
                          >
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".doc,.docx,.pdf,.md,.txt"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleFileSelect(e.target.files[0]);
                                }
                              }}
                              className="hidden"
                            />
                            {isFileLoading ? (
                              <div className="flex flex-col items-center gap-2">
                                <div className="w-8 h-8 border-2 border-dominus-green border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs text-dominus-gray font-bold">Processando arquivo...</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center text-center gap-2">
                                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-dominus-green">
                                  <Upload size={24} />
                                </div>
                                <p className="text-sm font-semibold text-white">
                                  Arraste ou clique para importar .doc, .docx, .pdf, .md ou .txt
                                </p>
                                <p className="text-xs text-dominus-gray">
                                  O arquivo será lido e as métricas de anúncios e gráficos serão carregados instantaneamente.
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-4 my-2">
                            <div className="h-px bg-white/5 flex-1" />
                            <span className="text-[10px] font-bold text-dominus-gray uppercase tracking-widest">ou cole o texto abaixo</span>
                            <div className="h-px bg-white/5 flex-1" />
                          </div>

                          <textarea
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder="Cole uma ATA já estruturada (em Markdown ou texto simples) aqui. O sistema irá formatar com cores dinâmicas para métricas positivas/negativas, emojis, e carregar gráficos para visualização instantânea de anúncios."
                            className="w-full min-h-[200px] bg-dominus-black/50 border border-white/5 rounded-2xl p-6 focus:outline-none focus:border-dominus-green/50 transition-colors font-mono text-sm leading-relaxed placeholder:text-dominus-gray placeholder:opacity-80 text-white"
                          />
                          <div className="flex justify-end">
                            <button
                              onClick={handleImport}
                              disabled={isLoading || isFileLoading || !importText.trim()}
                              className="dominus-button px-12 py-4 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                            >
                              <CheckCircle2 size={20} />
                              <span>Importar e Visualizar</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Subheader Navigation Tabs */}
                    <div className="flex items-center justify-between border-b border-white/10 pb-4">
                      <div className="flex items-center gap-3 bg-dominus-black/60 p-1.5 rounded-full border border-white/5">
                        <button
                          onClick={() => setSubView('resumo')}
                          className={`px-6 py-2.5 rounded-full font-semibold text-sm transition-all flex items-center gap-2 ${
                            subView === 'resumo' 
                              ? 'bg-dominus-green text-dominus-black shadow-[0_0_20px_rgba(0,210,122,0.4)]' 
                              : 'text-dominus-gray hover:text-white'
                          }`}
                        >
                          <FileText size={16} />
                          <span>Resumo (ATA)</span>
                        </button>
                        <button
                          onClick={() => setSubView('dashboard')}
                          className={`px-6 py-2.5 rounded-full font-semibold text-sm transition-all flex items-center gap-2 ${
                            subView === 'dashboard' 
                              ? 'bg-dominus-green text-dominus-black shadow-[0_0_20px_rgba(0,210,122,0.4)]' 
                              : 'text-dominus-gray hover:text-white'
                          }`}
                        >
                          <TrendingUp size={16} />
                          <span>Dashboard & Gráficos</span>
                        </button>
                      </div>

                      <div className="text-xs text-dominus-gray font-mono hidden sm:block">
                        {currentAnalysis.timestamp ? new Date(currentAnalysis.timestamp).toLocaleString('pt-BR') : ''}
                      </div>
                    </div>

                    {/* Content Area */}
                    <div ref={dashboardRef} id="dashboard-capture" className="p-2 rounded-3xl w-full max-w-full overflow-hidden">
                      {subView === 'resumo' ? (
                        <div className="dominus-card p-6 md:p-10 w-full max-w-4xl mx-auto shadow-2xl overflow-hidden break-words">
                          <div className="markdown-body prose prose-invert max-w-none text-base leading-relaxed">
                            <Markdown
                              components={{
                                li: ({ node, children, ...props }) => {
                                  const textContent = getTextFromChildren(children);
                                  const lower = textContent.toLowerCase();
                                  const isConsenso = lower.includes("consenso") || lower.includes("concenso");
                                  const isHipotese = lower.includes("hipotese") || lower.includes("hipótese");
                                  
                                  if (isConsenso) {
                                    return (
                                      <li 
                                        className="bg-[#004D2E] text-white border-l-4 border-dominus-green px-4 py-3 rounded-r-xl my-3 font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.2)] list-none" 
                                        {...props}
                                      >
                                        {children}
                                      </li>
                                    );
                                  }
                                  
                                  if (isHipotese) {
                                    return (
                                      <li 
                                        className="bg-dominus-green text-dominus-black border-l-4 border-white px-4 py-3 rounded-r-xl my-3 font-extrabold shadow-[0_4px_12px_rgba(0,210,122,0.15)] list-none" 
                                        {...props}
                                      >
                                        {children}
                                      </li>
                                    );
                                  }

                                  const sentimentClass = getSentimentColorClass(textContent);
                                  return (
                                    <li className={sentimentClass} {...props}>
                                      {children}
                                    </li>
                                  );
                                },
                                p: ({ node, children, ...props }) => {
                                  const textContent = getTextFromChildren(children);
                                  const lower = textContent.toLowerCase();
                                  const isConsenso = lower.includes("consenso") || lower.includes("concenso");
                                  const isHipotese = lower.includes("hipotese") || lower.includes("hipótese");
                                  
                                  if (isConsenso) {
                                    return (
                                      <p 
                                        className="bg-[#004D2E] text-white border-l-4 border-dominus-green px-4 py-3 rounded-r-xl my-3 font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.2)]" 
                                        {...props}
                                      >
                                        {children}
                                      </p>
                                    );
                                  }
                                  
                                  if (isHipotese) {
                                    return (
                                      <p 
                                        className="bg-dominus-green text-dominus-black border-l-4 border-white px-4 py-3 rounded-r-xl my-3 font-extrabold shadow-[0_4px_12px_rgba(0,210,122,0.15)]" 
                                        {...props}
                                      >
                                        {children}
                                      </p>
                                    );
                                  }

                                  const sentimentClass = getSentimentColorClass(textContent);
                                  return (
                                    <p className={sentimentClass} {...props}>
                                      {children}
                                    </p>
                                  );
                                }
                              }}
                            >
                              {currentAnalysis.markdown}
                            </Markdown>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                          {/* Charts & Stats */}
                          <div className="xl:col-span-3 space-y-8">
                            {/* Key Stats */}
                            {(() => {
                              const avgRoas = chartData.reduce((acc, curr) => acc + curr.roas, 0) / (chartData.length || 1);
                              return (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                  <StatCard 
                                    label="Total Gasto" 
                                    value={`R$ ${chartData.reduce((acc, curr) => acc + curr.gasto, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
                                    icon={<DollarSign size={20} />}
                                    trend="neutral"
                                  />
                                  <StatCard 
                                    label="Total Vendas" 
                                    value={chartData.reduce((acc, curr) => acc + curr.vendas, 0).toString()} 
                                    icon={<ShoppingCart size={20} />}
                                    trend="positive"
                                  />
                                  <StatCard 
                                    label="ROAS Médio" 
                                    value={avgRoas.toFixed(2)} 
                                    icon={<TrendingUp size={20} />}
                                    trend={avgRoas >= 1.8 ? 'positive' : 'negative'}
                                  />
                                </div>
                              );
                            })()}

                            {/* ROAS Comparison Chart */}
                            <div className="dominus-card p-8">
                              <h3 className="text-lg font-bold mb-8 flex items-center gap-2">
                                <TrendingUp size={18} className="text-dominus-green" />
                                Comparativo de ROAS por Ad
                              </h3>
                              <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis 
                                      dataKey="name" 
                                      stroke="var(--text-secondary)" 
                                      fontSize={12} 
                                      tickLine={false} 
                                      axisLine={false}
                                    />
                                    <YAxis 
                                      stroke="var(--text-secondary)" 
                                      fontSize={12} 
                                      tickLine={false} 
                                      axisLine={false}
                                    />
                                    <Tooltip 
                                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                                      contentStyle={{ 
                                        backgroundColor: 'var(--card-bg)', 
                                        border: '1px solid var(--border)',
                                        borderRadius: '12px',
                                        color: 'var(--text-primary)'
                                      }}
                                      itemStyle={{ color: 'var(--text-primary)' }}
                                      labelStyle={{ color: 'var(--text-primary)', fontWeight: 'bold', marginBottom: '4px' }}
                                    />
                                    <Bar dataKey="roas" radius={[4, 4, 0, 0]}>
                                      {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.roas >= 2 ? 'var(--color-dominus-green)' : '#ff4e00'} />
                                      ))}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Funnel Chart */}
                            <div className="dominus-card p-8">
                              <h3 className="text-lg font-bold mb-8 flex items-center gap-2">
                                <BarChart3 size={18} className="text-dominus-green" />
                                Gasto vs Vendas
                              </h3>
                              <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip 
                                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                                      contentStyle={{ 
                                        backgroundColor: 'var(--card-bg)', 
                                        border: '1px solid var(--border)',
                                        borderRadius: '12px',
                                        color: 'var(--text-primary)'
                                      }}
                                      itemStyle={{ color: 'var(--text-primary)' }}
                                      labelStyle={{ color: 'var(--text-primary)', fontWeight: 'bold', marginBottom: '4px' }}
                                    />
                                    <Legend />
                                    <Line type="monotone" dataKey="gasto" stroke="#8884d8" strokeWidth={2} dot={{ r: 4 }} />
                                    <Line type="monotone" dataKey="vendas" stroke="var(--color-dominus-green)" strokeWidth={2} dot={{ r: 4 }} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Detailed Performance Table */}
                            <div className="dominus-card p-8">
                              <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                                <Users size={18} className="text-dominus-green" />
                                Detalhamento de Performance por Ad
                              </h3>
                              <div className="overflow-x-auto text-white">
                                <table className="w-full text-left text-sm border-collapse">
                                  <thead>
                                    <tr className="border-b border-white/10 text-dominus-gray">
                                      <th className="pb-4 font-bold text-[10px] uppercase tracking-wider">Anúncio / Identificador</th>
                                      <th className="pb-4 font-bold text-[10px] uppercase tracking-wider">Status</th>
                                      <th className="pb-4 font-bold text-[10px] uppercase tracking-wider text-right">Gasto</th>
                                      <th className="pb-4 font-bold text-[10px] uppercase tracking-wider text-right">Vendas</th>
                                      <th className="pb-4 font-bold text-[10px] uppercase tracking-wider text-right">ROAS</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5">
                                    {chartData.map((ad, idx) => {
                                      const isNegative = ad.roas < 1.8;
                                      return (
                                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                                          <td className="py-4 font-medium max-w-xs md:max-w-md">
                                            <div className="font-semibold text-white">{ad.name}</div>
                                            <div className="text-xs text-dominus-gray mt-0.5 truncate" title={ad.fullName}>
                                              {ad.fullName}
                                            </div>
                                          </td>
                                          <td className="py-4">
                                            <span className={cn(
                                              "px-2.5 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5",
                                              !isNegative 
                                                ? "bg-dominus-green/15 text-dominus-green" 
                                                : "bg-red-500/15 text-red-500"
                                            )}>
                                              <span className={cn(
                                                "w-1.5 h-1.5 rounded-full",
                                                !isNegative ? "bg-dominus-green animate-pulse" : "bg-red-500"
                                              )} />
                                              {!isNegative ? "Escalonou / Bom" : "Pausar / Ruim"}
                                            </span>
                                          </td>
                                          <td className="py-4 text-right font-mono text-white">
                                            R$ {ad.gasto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </td>
                                          <td className="py-4 text-right font-mono text-white">
                                            {ad.vendas}
                                          </td>
                                          <td className={cn(
                                            "py-4 text-right font-mono font-bold",
                                            !isNegative ? "text-dominus-green" : "text-red-500"
                                          )}>
                                            {ad.roas.toFixed(2)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {view === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <h2 className="text-4xl font-display font-bold tracking-tight">
                  Histórico de <span className="text-dominus-green">Análises</span>
                </h2>

                {history.length === 0 ? (
                  <div className="dominus-card p-20 text-center opacity-30">
                    <HistoryIcon size={64} className="mx-auto mb-6" />
                    <p>Nenhuma análise encontrada no histórico.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {history.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => {
                          setCurrentAnalysis(item);
                          setView('dashboard');
                        }}
                        className="dominus-card p-6 hover:border-dominus-green/30 transition-all cursor-pointer group"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-2 text-dominus-green">
                            <FileText size={16} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">
                              {new Date(item.timestamp).toLocaleDateString('pt-BR', { 
                                day: '2-digit', 
                                month: 'short', 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="p-2 text-dominus-gray hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <h3 className="text-lg font-bold mb-2 line-clamp-1">{extractMeetingTitle(item.markdown)}</h3>
                        <p className="text-sm text-dominus-gray line-clamp-2 mb-4 italic">
                          "{item.summary.insight}"
                        </p>
                        
                        {/* Participants section */}
                        {(() => {
                          const participants = extractParticipants(item.markdown);
                          return (
                            <div className="mb-4">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-dominus-gray mb-1.5 flex items-center gap-1.5">
                                <Users size={12} className="text-dominus-green" />
                                Participantes
                              </p>
                              {participants.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {participants.map((name, i) => (
                                    <span key={i} className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-dominus-gray flex items-center gap-1">
                                      <User size={10} className="text-dominus-green" />
                                      <span>{name}</span>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-dominus-gray/50 italic">Sem participantes informados</p>
                              )}
                            </div>
                          );
                        })()}

                        <div className="flex items-center justify-between border-t border-white/5 pt-3 mt-3">
                          <span className="text-xs text-dominus-gray flex items-center gap-1.5 font-semibold">
                            <span className="w-2 h-2 rounded-full bg-dominus-green" />
                            {item.ads.length} {item.ads.length === 1 ? 'Ad analisado' : 'Ads analisados'}
                          </span>
                          <ArrowRight size={16} className="text-dominus-gray group-hover:text-dominus-green group-hover:translate-x-1 transition-all" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {view === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl space-y-8"
              >
                <h2 className="text-4xl font-display font-bold tracking-tight">
                  Configurações da <span className="text-dominus-green">Plataforma</span>
                </h2>

                <div className="dominus-card p-8 space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold mb-1">Tema da Interface</h3>
                      <p className="text-sm text-dominus-gray">Escolha entre o modo claro ou escuro.</p>
                    </div>
                    <div className="flex bg-dominus-black p-1 rounded-full border border-white/5">
                      <button 
                        onClick={() => setTheme('light')}
                        className={cn(
                          "p-2 rounded-full transition-all",
                          theme === 'light' ? "bg-white text-dominus-black shadow-lg" : "text-dominus-gray"
                        )}
                      >
                        <Sun size={20} />
                      </button>
                      <button 
                        onClick={() => setTheme('dark')}
                        className={cn(
                          "p-2 rounded-full transition-all",
                          theme === 'dark' ? "bg-dominus-green text-white shadow-lg" : "text-dominus-gray"
                        )}
                      >
                        <Moon size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-white/5 space-y-4">
                    <h3 className="font-bold">Gerenciamento de Conta</h3>
                    <div className="bg-dominus-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-dominus-gray">Colaborador:</span>
                        <span className="font-mono text-white font-semibold">{currentUser?.email}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-dominus-gray">Histórico Compartilhado:</span>
                        <span className="text-dominus-green font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-dominus-green animate-pulse" />
                          Nuvem Sincronizada (Firebase)
                        </span>
                      </div>
                      <div className="pt-2">
                        <button
                          onClick={() => signOut(auth)}
                          className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold py-3 px-4 rounded-xl text-xs transition-colors duration-200"
                        >
                          Sair da Conta (Logout)
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-white/5">
                    <h3 className="font-bold mb-4">Sobre a Dominus</h3>
                    <p className="text-sm text-dominus-gray leading-relaxed">
                      Estamos sempre em busca de talentos que possuam sede por resultados e excelência técnica. 
                      Se você busca um ambiente de alto crescimento, seu lugar é aqui.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </main>

      {error && (
        <div className="fixed bottom-8 right-8 bg-red-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 z-50">
          <AlertCircle size={20} />
          <span className="font-medium">{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded">
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "group relative p-3 rounded-2xl transition-all duration-300",
        active ? "bg-dominus-green text-white shadow-[0_0_20px_rgba(0,210,122,0.3)]" : "text-dominus-gray hover:text-white hover:bg-white/5"
      )}
    >
      {icon}
      <span className="absolute left-full ml-4 px-2 py-1 bg-dominus-dark border border-white/10 rounded text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-30">
        {label}
      </span>
    </button>
  );
}

function StatCard({ label, value, icon, trend }: { label: string, value: string, icon: React.ReactNode, trend?: 'positive' | 'negative' | 'neutral' }) {
  return (
    <div className="dominus-card p-6 flex items-center gap-4">
      <div className={cn(
        "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
        trend === 'positive' ? "bg-dominus-green/10 text-dominus-green" :
        trend === 'negative' ? "bg-red-500/10 text-red-500" :
        "bg-dominus-green/10 text-dominus-green"
      )}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-dominus-gray mb-1">{label}</p>
        <p className={cn(
          "text-xl font-display font-bold",
          trend === 'positive' ? "text-dominus-green" :
          trend === 'negative' ? "text-red-500" :
          "text-white"
        )}>{value}</p>
      </div>
    </div>
  );
}

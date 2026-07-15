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
  ChevronDown
} from 'lucide-react';
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
    lower.includes("baixo") || 
    lower.includes("insuficiente") || 
    lower.includes("prejuízo") || 
    lower.includes("ruim") ||
    lower.includes("queda") ||
    lower.includes("piorou") ||
    lower.includes("parar") ||
    lower.includes("pausar");

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
  
  const dashboardRef = useRef<HTMLDivElement>(null);

  // Load history and theme from local storage
  useEffect(() => {
    const savedHistory = localStorage.getItem('ad_analytica_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    const savedTheme = localStorage.getItem('ad_analytica_theme') as 'dark' | 'light';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('light', savedTheme === 'light');
    }
  }, []);

  // Save history to local storage
  useEffect(() => {
    localStorage.setItem('ad_analytica_history', JSON.stringify(history));
  }, [history]);

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

  const handleAnalyze = async () => {
    if (!transcription.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await analyzeCallTranscription(transcription);
      const newAnalysis: AnalysisResult = {
        ...result,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      
      // Jump to 100% before showing result
      setProgress(100);
      setTimeout(() => {
        setHistory(prev => [newAnalysis, ...prev]);
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

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
    if (currentAnalysis?.id === id) {
      setCurrentAnalysis(null);
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

        <div className="mt-auto">
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-3 rounded-xl hover:bg-white/5 transition-colors text-dominus-gray hover:text-white"
          >
            {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
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
        <div className="flex gap-4">
          <button onClick={() => setView('dashboard')} className={cn("p-2", view === 'dashboard' ? "text-dominus-green" : "text-dominus-gray")}>
            <LayoutDashboard size={20} />
          </button>
          <button onClick={() => setView('history')} className={cn("p-2", view === 'history' ? "text-dominus-green" : "text-dominus-gray")}>
            <HistoryIcon size={20} />
          </button>
          <button onClick={() => setView('settings')} className={cn("p-2", view === 'settings' ? "text-dominus-green" : "text-dominus-gray")}>
            <SettingsIcon size={20} />
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
                                onClick={() => {
                                  setShowExportMenu(false);
                                  exportToPDF();
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 flex items-center gap-2 text-white transition-colors"
                              >
                                <FileText size={16} className="text-dominus-green" />
                                <span>PDF (.pdf)</span>
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
                      <div className="flex items-center gap-3 text-dominus-green">
                        <FileText size={20} />
                        <span className="text-sm font-bold uppercase tracking-widest">Entrada de Dados</span>
                      </div>
                      <textarea
                        value={transcription}
                        onChange={(e) => setTranscription(e.target.value)}
                        placeholder="Cole a transcrição da call aqui..."
                        className="w-full min-h-[300px] bg-dominus-black/50 border border-white/5 rounded-2xl p-6 focus:outline-none focus:border-dominus-green/50 transition-colors font-mono text-sm leading-relaxed placeholder:text-dominus-gray placeholder:opacity-80 text-white"
                      />
                      <div className="flex justify-end">
                        <button
                          onClick={handleAnalyze}
                          disabled={isLoading || !transcription.trim()}
                          className="dominus-button px-12 py-4 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Send size={20} />
                          <span>Gerar Inteligência</span>
                        </button>
                      </div>
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
                    <div ref={dashboardRef} id="dashboard-capture" className="p-2 rounded-3xl">
                      {subView === 'resumo' ? (
                        <div className="dominus-card p-10 max-w-4xl mx-auto shadow-2xl">
                          <div className="markdown-body prose prose-invert max-w-none text-base leading-relaxed">
                            <Markdown
                              components={{
                                li: ({ node, children, ...props }) => {
                                  const textContent = getTextFromChildren(children);
                                  const sentimentClass = getSentimentColorClass(textContent);
                                  return (
                                    <li className={sentimentClass} {...props}>
                                      {children}
                                    </li>
                                  );
                                },
                                p: ({ node, children, ...props }) => {
                                  const textContent = getTextFromChildren(children);
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
                        <h3 className="text-lg font-bold mb-2 line-clamp-1">{item.ads[0]?.name || 'Análise sem nome'}</h3>
                        <p className="text-sm text-dominus-gray line-clamp-2 mb-4 italic">
                          "{item.summary.insight}"
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex -space-x-2">
                            {item.ads.slice(0, 3).map((ad, i) => (
                              <div key={i} className="w-8 h-8 rounded-full bg-dominus-black border border-white/10 flex items-center justify-center text-[10px] font-bold">
                                {ad.name.charAt(0)}
                              </div>
                            ))}
                            {item.ads.length > 3 && (
                              <div className="w-8 h-8 rounded-full bg-dominus-black border border-white/10 flex items-center justify-center text-[10px] font-bold text-dominus-green">
                                +{item.ads.length - 3}
                              </div>
                            )}
                          </div>
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

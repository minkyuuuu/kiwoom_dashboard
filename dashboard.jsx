import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  Plus, 
  Trash2, 
  Clock, 
  TrendingUp, 
  Search, 
  LayoutDashboard, 
  Image as ImageIcon,
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  MousePointer2,
  Calendar as CalendarIcon,
  ChevronRight,
  LayoutGrid,
  X,
  ChevronLeft
} from 'lucide-react';

// --- Gemini API Configuration ---
const apiKey = ""; 
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";

const App = () => {
  const [reports, setReports] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // 오늘 날짜를 YYYY-MM-DD 형식으로 가져오기
  const getTodayStr = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [errorMessage, setErrorMessage] = useState(null);
  
  // 리포트 내부 뷰 모드 (30초 간격 vs 당일 누적)
  const [reportViewMode, setReportViewMode] = useState('realtime');

  // 4개의 전용 업로드 슬롯 관리
  const [slots, setSlots] = useState({
    realtime: [],   // 30초간격 (최대 2장)
    cumulative: [], // 당일누적 (최대 2장)
    themesViews: null,  // 조회순위순 (1장)
    themesChange: null  // 등락률순 (1장)
  });

  const [activeSlot, setActiveSlot] = useState('realtime'); // 현재 포커스된 슬롯
  const fileInputRef = useRef(null);
  
  // --- Calendar State & Ref ---
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [currentViewDate, setCurrentViewDate] = useState(new Date()); 
  const calendarRef = useRef(null); // 외부 클릭 감지를 위한 ref

  // --- Helpers for Formatting & Color ---
  const getTrendColor = (val) => {
    if (val === undefined || val === null || val === "") return 'text-slate-600';
    const str = val.toString().trim();
    if (str.startsWith('+')) return 'text-rose-600';
    if (str.startsWith('-')) return 'text-blue-600';
    const num = parseFloat(str.replace(/[^0-9.-]/g, ""));
    if (!isNaN(num)) {
      if (num > 0) return 'text-rose-600';
      if (num < 0) return 'text-blue-600';
    }
    return 'text-slate-600';
  };

  const formatPrice = (price) => {
    if (!price) return "-";
    const numStr = price.toString().replace(/[^0-9.-]/g, "");
    const num = parseFloat(numStr);
    return isNaN(num) ? price : num.toLocaleString();
  };

  const formatPercent = (val) => {
    if (val === undefined || val === null || val === "") return "0%";
    const str = val.toString().trim();
    return str.includes('%') ? str : `${str}%`;
  };

  // --- Image Handling Functions ---
  const handleSlotClick = (slotId) => {
    setActiveSlot(slotId);
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    updateSlot(activeSlot, files);
    e.target.value = ''; 
  };

  const updateSlot = (slotId, files) => {
    if (files.length === 0) return;
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const newItems = imageFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file)
    }));

    setSlots(prev => {
      if (slotId === 'realtime' || slotId === 'cumulative') {
        const existing = prev[slotId] || [];
        return { ...prev, [slotId]: [...existing, ...newItems].slice(0, 2) };
      } else {
        return { ...prev, [slotId]: newItems[0] };
      }
    });
  };

  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData.items;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          files.push(items[i].getAsFile());
        }
      }
      if (files.length > 0) updateSlot(activeSlot, files);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeSlot]);

  // --- Calendar Click Outside Logic ---
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        setIsCalendarOpen(false);
      }
    };
    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCalendarOpen]);

  const removeFile = (slotId, id) => {
    setSlots(prev => {
      if (slotId === 'realtime' || slotId === 'cumulative') {
        return { ...prev, [slotId]: prev[slotId].filter(f => f.id !== id) };
      } else {
        return { ...prev, [slotId]: null };
      }
    });
  };

  const deleteReport = (e, reportId) => {
    e.stopPropagation(); 
    setReports(prev => {
      const updated = prev.filter(r => r.id !== reportId);
      if (activeTab === reportId) {
        setActiveTab(updated.length > 0 ? updated[updated.length - 1].id : null);
      }
      return updated;
    });
  };

  // --- Custom Calendar Logic ---
  const generateCalendarDays = () => {
    const year = currentViewDate.getFullYear();
    const month = currentViewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const handleDateSelect = (date) => {
    if (!date) return;
    
    // 미래 날짜 선택 방지 체크 (방어적 로직)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date > today) return;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    setSelectedDate(`${year}-${month}-${day}`);
    setIsCalendarOpen(false);
  };

  const changeMonth = (offset) => {
    setCurrentViewDate(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() + offset, 1));
  };

  // --- AI Data Extraction (Gemini API) ---
  const runAnalysis = async () => {
    const hasRealtime = slots.realtime.length > 0;
    const hasCumulative = slots.cumulative.length > 0;
    const hasThemes = slots.themesViews || slots.themesChange;

    if (!(hasRealtime || hasCumulative) || !hasThemes) {
      setErrorMessage("종목 순위 이미지와 테마 이미지를 각각 최소 1장 이상 업로드해주세요.");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const payloadParts = [];
      const fileToBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
      });

      const addToPayload = async (slotId, items, description) => {
        if (!items) return;
        const list = Array.isArray(items) ? items : [items];
        for (const item of list) {
          const base64 = await fileToBase64(item.file);
          payloadParts.push({ text: `Image Source [${description}]:` });
          payloadParts.push({
            inlineData: { mimeType: item.file.type, data: base64.split(',')[1] }
          });
        }
      };

      await addToPayload('realtime', slots.realtime, "30초간격 종목순위");
      await addToPayload('cumulative', slots.cumulative, "당일누적 종목순위");
      await addToPayload('themesViews', slots.themesViews, "조회순위순 테마");
      await addToPayload('themesChange', slots.themesChange, "등락률순 테마");

      const systemPrompt = `
        당신은 주식 시장의 스크린샷 데이터를 분석하는 전문가입니다.
        제공된 이미지는 각각 [30초간격/당일누적/조회순위순/등락률순]으로 분류되어 전달됩니다.
        각 소스의 설명에 맞춰 다음 JSON 형식으로 응답하세요:
        1. extractedTime: 이미지 좌측 상단의 시각 ("hh:mm").
        2. marketStatus: { 
             kospi, kospiChange, kospiChangeAmount, 
             kosdaq, kosdaqChange, kosdaqChangeAmount 
           }
        3. realtimeStocks: "30초간격" 소스에서 추출한 20개 종목 리스트 (rank, name, price, changePercent).
        4. cumulativeStocks: "당일누적" 소스에서 추출한 20개 종목 리스트 (rank, name, price, changePercent).
        5. themesByRank: "조회순위순" 소스에서 추출한 10개 테마 (name, changePercent).
        6. themesByChange: "등락률순" 소스에서 추출한 10개 테마 (name, changePercent).
        주의: 등락 수치(ChangeAmount)는 부호(+ 또는 -)를 포함하여 추출하세요.
      `;

      const fetchWithRetry = async (url, options, retries = 5, backoff = 1000) => {
        try {
          const response = await fetch(url, options);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return await response.json();
        } catch (error) {
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
          }
          throw error;
        }
      };

      const result = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [...payloadParts, { text: "이미지를 정밀하게 분석하여 JSON 리포트를 생성하세요." }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("AI 분석 실패");
      
      const parsedData = JSON.parse(rawText);
      const generateAutoTitle = (time) => {
        if (!time) return "시장 리포트";
        const parts = time.split(':');
        const hour = parseInt(parts[0]);
        let period = "마감";
        if (hour < 12) period = "오전";
        else if (hour >= 12 && hour < 14) period = "점심";
        else if (hour >= 14 && hour < 16) period = "오후";
        return `${period} (${time})`;
      };

      const newReport = {
        id: crypto.randomUUID(),
        date: selectedDate,
        title: generateAutoTitle(parsedData.extractedTime),
        timestamp: parsedData.extractedTime || "현재",
        data: {
          ...parsedData,
          marketStatus: parsedData.marketStatus || { 
            kospi: "-", kospiChange: "0%", kospiChangeAmount: "0.00",
            kosdaq: "-", kosdaqChange: "0%", kosdaqChangeAmount: "0.00" 
          },
          realtimeStocks: parsedData.realtimeStocks || [],
          cumulativeStocks: parsedData.cumulativeStocks || [],
          themesByRank: parsedData.themesByRank || [],
          themesByChange: parsedData.themesByChange || []
        }
      };

      setReports(prev => {
        const updatedList = [...prev, newReport];
        return updatedList.sort((a, b) => {
          const timeA = a.timestamp === "현재" ? "23:59" : a.timestamp;
          const timeB = b.timestamp === "현재" ? "23:59" : b.timestamp;
          return timeA.localeCompare(timeB);
        });
      });
      
      setActiveTab(newReport.id);
      setReportViewMode(newReport.data.realtimeStocks.length > 0 ? 'realtime' : 'cumulative');
      setSlots({ realtime: [], cumulative: [], themesViews: null, themesChange: null });
    } catch (error) {
      console.error(error);
      setErrorMessage("분석 중 오류가 발생했습니다. 이미지가 선명한지, 그리고 API 설정이 올바른지 확인해주세요.");
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredReports = reports.filter(r => r.date === selectedDate);
  const activeReport = reports.find(r => r.id === activeTab);

  const UploadSlot = ({ id, label, current, max = 1 }) => {
    const isActive = activeSlot === id;
    const [isDragOver, setIsDragOver] = useState(false);
    const items = Array.isArray(current) ? current : (current ? [current] : []);
    
    return (
      <div 
        onClick={() => setActiveSlot(id)}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => { 
          e.preventDefault(); 
          setIsDragOver(false); 
          const files = Array.from(e.dataTransfer.files); 
          if (files.length > 0) { 
            setActiveSlot(id); 
            updateSlot(id, files); 
          } 
        }}
        className={`group p-4 rounded-2xl border-2 transition-all cursor-pointer relative ${
          isActive ? 'border-rose-400 bg-white shadow-lg shadow-rose-100/50 scale-[1.02] z-10' 
                   : isDragOver ? 'border-blue-400 bg-blue-50/30 shadow-lg' : 'border-slate-100 bg-white hover:border-slate-200'
        }`}
      >
        <div className="flex justify-between items-center mb-2">
          <span className={`text-[12px] font-bold ${isActive ? 'text-rose-500' : 'text-slate-600'}`}>
            {label} {max > 1 && items.length > 0 && <span className="text-[10px] opacity-60 ml-1">({items.length}/{max})</span>}
          </span>
          {isActive && <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></div>}
        </div>
        <div 
          onClick={(e) => { e.stopPropagation(); handleSlotClick(id); }}
          className={`border-2 border-dashed rounded-xl py-4 flex flex-col items-center justify-center gap-1 transition-colors
            ${isActive ? 'border-rose-100 bg-rose-50/30' : isDragOver ? 'border-blue-200 bg-blue-50/50' : 'border-slate-50 bg-slate-50/50 group-hover:bg-slate-50'}`}
        >
          {items.length === 0 ? (
            <div className="text-center">
              <Upload className={`w-4 h-4 mx-auto mb-1 ${isActive ? 'text-rose-300' : isDragOver ? 'text-blue-400' : 'text-slate-300'}`} />
              <span className="text-[9px] font-black text-slate-400 tracking-widest uppercase">클릭 또는 드롭</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 px-2">
              {items.map(item => (
                <div key={item.id} className="relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 group/item">
                  <img src={item.preview} className="w-full h-full object-cover" alt="prev" />
                  <button onClick={(e) => { e.stopPropagation(); removeFile(id, item.id); }} className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                    <Trash2 size={12} className="text-white" />
                  </button>
                </div>
              ))}
              {items.length < max && (
                <div className="w-10 h-10 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-300"><Plus size={14} /></div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden font-sans text-slate-900">
      
      {/* Custom Error Message Toast */}
      {errorMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-white/10">
            <AlertCircle className="text-rose-400" size={18} />
            <span className="text-sm font-medium">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-2 hover:text-rose-400 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-[320px] bg-white border-r border-slate-100 flex flex-col overflow-y-auto z-20 shadow-sm shrink-0">
        <div className="p-6 bg-[#121926] text-white">
          <div className="flex items-center gap-2 mb-6">
            <LayoutGrid className="w-5 h-5 text-rose-400" />
            <h1 className="text-lg font-bold tracking-tight">Market Analyzer</h1>
          </div>
          <div className="space-y-4">
            
            {/* --- Custom Calendar Trigger & Popover --- */}
            <div className="relative" ref={calendarRef}>
              <button 
                onClick={() => setIsCalendarOpen(!isCalendarOpen)} 
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all group ${isCalendarOpen ? 'bg-rose-500 border-rose-400 shadow-lg shadow-rose-900/20' : 'bg-[#1E293B] border-slate-700/50 hover:bg-[#2D3A4F]'}`}
              >
                <div className="flex items-center gap-3">
                  <CalendarIcon className={`w-4 h-4 ${isCalendarOpen ? 'text-white' : 'text-slate-400 group-hover:text-rose-400'}`} />
                  <span className={`text-sm font-medium tracking-wide ${isCalendarOpen ? 'text-white' : 'text-white/90'}`}>{selectedDate}</span>
                </div>
                <ChevronRight className={`w-4 h-4 transition-transform ${isCalendarOpen ? 'text-white rotate-90' : 'text-slate-500'}`} />
              </button>

              {isCalendarOpen && (
                <div className="absolute top-full left-0 right-0 mt-3 bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 z-50 text-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex justify-between items-center mb-4 px-1">
                    <button onClick={() => changeMonth(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg transition-colors"><ChevronLeft size={16} /></button>
                    <span className="text-sm font-black tracking-tight">
                      {currentViewDate.getFullYear()}년 {currentViewDate.getMonth() + 1}월
                    </span>
                    <button onClick={() => changeMonth(1)} className="p-1.5 hover:bg-slate-50 rounded-lg transition-colors"><ChevronRight size={16} /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                      <div key={d} className="text-[10px] font-black text-slate-300 text-center">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {generateCalendarDays().map((date, i) => {
                      if (!date) return <div key={`empty-${i}`} className="p-2"></div>;
                      
                      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                      const isSelected = selectedDate === dateStr;
                      
                      // 미래 날짜 체크
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const isFuture = date > today;

                      return (
                        <button 
                          key={dateStr}
                          onClick={() => !isFuture && handleDateSelect(date)}
                          disabled={isFuture}
                          className={`p-2 text-[11px] font-bold rounded-lg transition-all 
                            ${isSelected ? 'bg-rose-500 text-white shadow-md shadow-rose-200 scale-110' : 
                              isFuture ? 'text-slate-200 cursor-not-allowed opacity-50' : 'hover:bg-slate-50 text-slate-600'}`}
                        >
                          {date.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 px-1">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">분석 준비 완료</span>
            </div>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-6 flex-1 border-b border-slate-50">
          <div className="px-1"><h2 className="text-[10px] font-black text-slate-400 tracking-[0.2em] uppercase">분류별 업로드</h2></div>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple accept="image/*" />
          <div className="flex flex-col gap-3">
            <UploadSlot id="realtime" label="30초간격 (종목)" current={slots.realtime} max={2} />
            <UploadSlot id="cumulative" label="당일누적 (종목)" current={slots.cumulative} max={2} />
            <UploadSlot id="themesViews" label="조회순위순 (테마)" current={slots.themesViews} />
            <UploadSlot id="themesChange" label="등락률순 (테마)" current={slots.themesChange} />
          </div>
          <div className="pt-2">
            <button 
              onClick={runAnalysis} 
              disabled={isProcessing} 
              className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg 
                ${isProcessing ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-rose-500 text-white hover:bg-rose-600 active:scale-95 shadow-rose-100'}`}
            >
              {isProcessing ? <><Loader2 className="animate-spin" size={18} /> 분석중...</> : <><Plus size={18} strokeWidth={3} /> 리포트 생성</>}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]">
        {filteredReports.length > 0 && (
          <nav className="p-4 md:px-10 bg-white border-b border-slate-100 overflow-x-auto">
            <div className="flex gap-2 max-w-7xl mx-auto">
              {filteredReports.map((report) => (
                <div 
                  key={report.id}
                  className={`flex items-center gap-1 pl-5 pr-3 py-2.5 rounded-full font-bold transition-all group ${activeTab === report.id ? 'bg-[#121926] text-white shadow-xl scale-105' : 'bg-white text-slate-500 border border-slate-100 shadow-sm hover:border-slate-300'}`}
                >
                  <button 
                    onClick={() => { setActiveTab(report.id); setReportViewMode(report.data.realtimeStocks.length > 0 ? 'realtime' : 'cumulative'); }} 
                    className="flex items-center gap-2 whitespace-nowrap"
                  >
                    <Clock size={16} /> {report.title}
                  </button>
                  <button 
                    onClick={(e) => deleteReport(e, report.id)}
                    className={`ml-2 p-1 rounded-full transition-colors ${activeTab === report.id ? 'hover:bg-slate-700 text-slate-400 hover:text-rose-400' : 'hover:bg-rose-100 text-slate-300 hover:text-rose-500'}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </nav>
        )}

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          {!activeReport || activeReport.date !== selectedDate ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-6">
              <div className="w-32 h-32 bg-white rounded-[40px] shadow-2xl shadow-slate-200/50 flex items-center justify-center border border-slate-50 relative">
                <Search className="w-12 h-12 text-slate-100" />
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-slate-300 tracking-tight">{selectedDate}</p>
                <p className="text-[13px] font-medium text-slate-400 mt-2">
                  {filteredReports.length > 0 ? '상단 탭에서 리포트를 선택하세요' : '이 날짜에 생성된 리포트가 없습니다'}
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
              {/* 마켓 지수 영역 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {['kospi', 'kosdaq'].map(market => {
                  const mKey = market.toUpperCase();
                  const value = activeReport.data.marketStatus[market];
                  const change = activeReport.data.marketStatus[`${market}Change`];
                  const amount = activeReport.data.marketStatus[`${market}ChangeAmount`];
                  const hasValue = value && value !== "-" && value !== "0" && value !== 0;
                  const hasAmount = amount && amount !== "0.00" && amount !== "+0.00" && amount !== "-0.00";
                  const hasChange = change && change !== "0%" && change !== "0.00%";
                  const color = getTrendColor(change);
                  return (
                    <div key={market} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 min-h-[120px]">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{mKey} MARKET</p>
                      <div className="flex items-center gap-8">
                        <span className={`text-4xl font-black ${color}`}>
                          {hasValue ? value : ""}
                        </span>
                        <div className="flex flex-col text-[14px] font-bold leading-tight items-end">
                          <span className={color}>{hasAmount ? amount : ""}</span>
                          <span className={color}>{hasChange ? formatPercent(change).replace(/[+-]/g, '') : ""}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 종목 리스트 & 테마 랭킹 */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                <div className="xl:col-span-7 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-7 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">🔥 실시간 순위 TOP 20</h2>
                    <div className="flex items-center gap-4">
                      {activeReport.data.realtimeStocks.length > 0 && activeReport.data.cumulativeStocks.length > 0 ? (
                        <div className="flex bg-[#121926] p-1 rounded-xl shadow-lg border border-slate-800">
                          <button 
                            onClick={() => setReportViewMode('realtime')} 
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${reportViewMode === 'realtime' ? 'bg-white text-[#121926] shadow-sm' : 'text-slate-400 hover:text-white'}`}
                          >
                            30초 간격
                          </button>
                          <button 
                            onClick={() => setReportViewMode('cumulative')} 
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${reportViewMode === 'cumulative' ? 'bg-white text-[#121926] shadow-sm' : 'text-slate-400 hover:text-white'}`}
                          >
                            당일 누적
                          </button>
                        </div>
                      ) : (
                        <div className="bg-[#121926] px-4 py-2 rounded-xl shadow-sm border border-slate-100">
                          <h2 className="text-[13px] font-bold text-white flex items-center gap-2">
                            {activeReport.data.realtimeStocks.length > 0 ? '30초 간격' : '당일 누적'}
                          </h2>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm table-fixed min-w-[500px]">
                      <thead className="bg-slate-50/50 text-slate-400 font-bold border-b border-slate-50">
                        <tr>
                          <th className="p-4 pl-7 w-[60px]">순위</th>
                          <th className="p-4 w-[180px]">종목명</th>
                          <th className="p-4 text-right w-[120px]">주가</th>
                          <th className="p-4 pr-7 text-right w-[120px]">등락률</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {(reportViewMode === 'realtime' ? activeReport.data?.realtimeStocks : activeReport.data?.cumulativeStocks)?.map((stock, idx) => {
                          const trendColor = getTrendColor(stock.changePercent);
                          return (
                            <tr key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/50 transition-colors`}>
                              <td className="p-4 pl-7 font-black text-slate-800 truncate">{stock.rank || idx + 1}</td>
                              <td className="p-4 font-bold text-slate-800 truncate">{stock.name || "-"}</td>
                              <td className={`p-4 font-bold text-right ${trendColor} tabular-nums truncate`}>{formatPrice(stock.price)}</td>
                              <td className={`p-4 pr-7 text-right font-black ${trendColor} truncate`}>{formatPercent(stock.changePercent)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="xl:col-span-5 space-y-6">
                  {[{id: 'themesByRank', title: '조회순위순', dark: true}, {id: 'themesByChange', title: '등락률순', dark: false}].map(section => (
                    <div key={section.id} className={`${section.dark ? 'bg-[#121926] text-white border-slate-800' : 'bg-white text-slate-900 border-slate-100'} p-7 rounded-[2.5rem] shadow-xl relative overflow-hidden border`}>
                      <div className={`flex items-center gap-3 mb-6 border-b ${section.dark ? 'border-slate-800' : 'border-slate-50'} pb-4`}>
                        <span className={`p-2 ${section.dark ? 'bg-slate-800 text-rose-400' : 'bg-indigo-50 text-indigo-600'} rounded-xl`}><Search size={18} /></span>
                        <h3 className="text-lg font-black tracking-tighter">{section.title} TOP 10</h3>
                      </div>
                      <div className="space-y-2.5">
                        {activeReport.data[section.id]?.map((theme, idx) => {
                          const tColor = getTrendColor(theme.changePercent);
                          return (
                            <div key={idx} className={`flex justify-between items-center p-3.5 rounded-2xl ${section.dark ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-50 hover:bg-slate-100'} transition-all`}>
                              <span className="font-bold flex items-center">
                                <span className={`${section.dark ? 'text-rose-500' : 'text-slate-400'} mr-3 w-5 font-black text-xs`}>{idx + 1}</span> 
                                <span className="truncate max-w-[150px]">{theme.name || "-"}</span>
                              </span>
                              <span className={`font-black ${tColor} text-sm`}>{formatPercent(theme.changePercent)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* User Profile Info */}
      <div className="absolute top-6 right-6 flex items-center gap-4 z-10">
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-sm border border-slate-100">
          <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">PRO PLAN</span>
          <div className="w-8 h-8 bg-gradient-to-tr from-rose-400 to-rose-600 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-white text-[10px] font-black">AI</div>
        </div>
      </div>

    </div>
  );
};

export default App;
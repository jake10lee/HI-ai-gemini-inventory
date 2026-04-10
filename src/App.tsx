import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  orderBy,
  getDocFromServer,
  writeBatch
} from 'firebase/firestore';
import { 
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  PackageSearch, 
  Database, 
  Settings, 
  Plus, 
  Download, 
  Search, 
  ExternalLink, 
  Lightbulb, 
  Pencil, 
  Trash2, 
  X,
  Check,
  AlertCircle,
  AlertTriangle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { db, auth } from './lib/firebase';
import { cn } from './lib/utils';
import { InventoryItem, ProcessingStatus, InvoiceType } from './types';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- App Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({ active: false, total: 0, current: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | InvoiceType>('all');
  const [modal, setModal] = useState<{ open: boolean; title: string; content: string }>({ open: false, title: '', content: '' });
  
  const [editModal, setEditModal] = useState<{ open: boolean; data: InventoryItem | null }>({ open: false, data: null });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' });
  
  const [duplicateModal, setDuplicateModal] = useState<{
    open: boolean;
    duplicates: InventoryItem[];
    pending: InventoryItem[];
    resolve: ((action: 'exclude' | 'all' | 'cancel') => void) | null;
  }>({ open: false, duplicates: [], pending: [], resolve: null });

  const [showKeySetting, setShowKeySetting] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize AI
  const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' }), []);

  // Auth Effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      // Security: Check if user email is allowed
      const allowedEmails = ['yahgong@gmail.com']; // Add authorized emails here
      if (u && u.email && !allowedEmails.includes(u.email)) {
        auth.signOut();
        setModal({ 
          open: true, 
          title: "Access Denied", 
          content: "승인되지 않은 계정입니다. 관리자에게 문의하세요." 
        });
        return;
      }
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      // Use custom parameters to force account selection if needed
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed", error);
      let message = "로그인에 실패했습니다.";
      
      if (error.code === 'auth/unauthorized-domain') {
        message = "현재 도메인이 Firebase에 등록되지 않았습니다. Firebase 콘솔에서 'jake10lee.github.io'를 승인된 도메인에 추가해주세요.";
      } else if (error.code === 'auth/popup-blocked') {
        message = "팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.";
      } else if (error.code === 'auth/operation-not-allowed') {
        message = "Firebase 콘솔에서 Google 로그인이 활성화되지 않았습니다.";
      } else {
        message += ` (${error.code}: ${error.message})`;
      }
      
      setModal({ open: true, title: "Login Failed", content: message });
    } finally {
      setLoading(false);
    }
  };

  // Connection Test
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'inventory', 'connection-test'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  // Data Sync Effect
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const inventoryRef = collection(db, 'inventory');
    const q = query(inventoryRef, orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventory');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !user) return;

    setProcessingStatus({ active: true, total: files.length, current: 0 });

    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingStatus(prev => ({ ...prev, current: i + 1 }));
        const file = files[i] as File;
        
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
        });

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              parts: [
                { text: "Extract hardware invoice data from this image. Return ONLY a JSON object." },
                { inlineData: { mimeType: file.type, data: base64 } }
              ]
            }
          ],
          config: {
            systemInstruction: `Extract hardware invoice data.
            STRICT CLASSIFICATION LOGIC:
            1. Check 'Supplier/Provider' (공급자).
            2. If '한일공구사' IS the Provider, 'type' MUST BE 'sales'.
            3. If '한일공구사' IS NOT the Provider, 'type' MUST BE 'purchase'.
            Structure: { "type": "purchase"|"sales", "date": "YYYY-MM-DD", "company": "Counterparty", "items": [{ "brand": string, "name": string, "spec": string, "code": string, "quantity": number, "unit": string, "price": number }] }`,
            responseMimeType: "application/json"
          }
        });

        let rawText = response.text || "";
        if (!rawText) throw new Error("AI analysis failed to return content.");
        
        // Robust JSON extraction to handle potential trailing characters or markdown
        const startIdx = rawText.indexOf('{');
        const endIdx = rawText.lastIndexOf('}');
        if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
          throw new Error("Invalid JSON format in AI response.");
        }
        rawText = rawText.substring(startIdx, endIdx + 1);
        
        const parsed = JSON.parse(rawText);

        if (parsed && parsed.items) {
          const invoiceDate = parsed.date || new Date().toISOString().split('T')[0];
          
          const itemsToSave: InventoryItem[] = parsed.items.map((item: any) => ({
            type: parsed.type || 'purchase',
            date: invoiceDate,
            company: (parsed.company || "Unknown Company").slice(0, 200),
            brand: (item.brand || "").slice(0, 200),
            name: (item.name || "Unknown Item").slice(0, 500),
            spec: (item.spec || "").slice(0, 500),
            code: (item.code || "").slice(0, 200),
            quantity: Math.max(0, Number(item.quantity) || 0),
            unit: (item.unit || "").slice(0, 50),
            price: Math.max(0, Number(item.price) || 0),
          }));

          // Check for duplicates
          const duplicates = itemsToSave.filter(newItem => 
            inventory.some(existing => 
              existing.date === newItem.date &&
              existing.company === newItem.company &&
              existing.name === newItem.name &&
              existing.spec === newItem.spec &&
              existing.price === newItem.price &&
              existing.quantity === newItem.quantity
            )
          );

          let finalItems = itemsToSave;

          if (duplicates.length > 0) {
            const action = await new Promise<'exclude' | 'all' | 'cancel'>((resolve) => {
              setDuplicateModal({
                open: true,
                duplicates,
                pending: itemsToSave,
                resolve
              });
            });

            setDuplicateModal(prev => ({ ...prev, open: false }));

            if (action === 'cancel') continue;
            if (action === 'exclude') {
              finalItems = itemsToSave.filter(newItem => 
                !inventory.some(existing => 
                  existing.date === newItem.date &&
                  existing.company === newItem.company &&
                  existing.name === newItem.name &&
                  existing.spec === newItem.spec &&
                  existing.price === newItem.price &&
                  existing.quantity === newItem.quantity
                )
              );
            }
          }

          const inventoryRef = collection(db, 'inventory');
          for (const item of finalItems) {
            try {
              await addDoc(inventoryRef, {
                ...item,
                timestamp: serverTimestamp()
              });
            } catch (fsErr) {
              handleFirestoreError(fsErr, OperationType.CREATE, 'inventory');
            }
          }
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      setModal({ open: true, title: "Analysis Failed", content: error instanceof Error ? error.message : String(error) });
    } finally {
      setProcessingStatus({ active: false, total: 0, current: 0 });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveEdit = async () => {
    if (!editModal.data || !editModal.data.id || !user) return;
    setLoading(true);
    try {
      const docRef = doc(db, 'inventory', editModal.data.id);
      const { id, ...updatedData } = editModal.data;
      await updateDoc(docRef, updatedData as any);
      setEditModal({ open: false, data: null });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `inventory/${editModal.data.id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteConfirm.id || !user) return;
    setLoading(true);
    try {
      const docRef = doc(db, 'inventory', deleteConfirm.id);
      await deleteDoc(docRef);
      setDeleteConfirm({ open: false, id: null, name: '' });
      setSelectedIds(prev => prev.filter(id => id !== deleteConfirm.id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `inventory/${deleteConfirm.id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0 || !user) return;
    
    setDeleteConfirm({ 
      open: true, 
      id: 'BULK_DELETE', 
      name: `${selectedIds.length}개의 선택된 항목` 
    });
  };

  const executeBulkDelete = async () => {
    if (selectedIds.length === 0 || !user) return;
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const docRef = doc(db, 'inventory', id);
        batch.delete(docRef);
      });
      await batch.commit();
      setSelectedIds([]);
      setDeleteConfirm({ open: false, id: null, name: '' });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'inventory/bulk');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(item => item.id!).filter(Boolean));
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const generateProductGuide = async (item: InventoryItem) => {
    setLoading(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Write a detailed product guide in Korean for: [${item.brand}] ${item.name} (${item.spec}). Include usage tips and safety precautions.`
      });
      setModal({ open: true, title: `🤖 AI Guide: ${item.name}`, content: response.text || "No content generated." });
    } catch (e) {
      setModal({ open: true, title: "Error", content: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    const data = inventory.map(i => ({
      '구분': i.type === 'purchase' ? '매입' : '매출',
      '날짜': i.date || '-',
      '거래처': i.company,
      '제품코드': i.code,
      '브랜드': i.brand,
      '품명': i.name,
      '규격': i.spec,
      '단가': i.price,
      '수량': i.quantity,
      '금액': i.price * i.quantity,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `HI_AI_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const stats = useMemo(() => {
    const pItems = inventory.filter(i => i.type === 'purchase');
    const sItems = inventory.filter(i => i.type === 'sales');
    return { 
      purchase: pItems.reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0), 
      sales: sItems.reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
      brands: [...new Set(inventory.map(i => i.brand))].length,
      vendors: [...new Set(pItems.map(i => i.company))].length,
      count: inventory.length 
    };
  }, [inventory]);

  const filtered = inventory.filter(i => {
    const s = searchQuery.toLowerCase();
    const matchesSearch = (
      i.name?.toLowerCase().includes(s) || 
      i.company?.toLowerCase().includes(s) || 
      i.brand?.toLowerCase().includes(s) || 
      i.date?.includes(s)
    );
    const matchesType = filterType === 'all' || i.type === filterType;
    return matchesSearch && matchesType;
  });

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl p-10 text-center animate-in fade-in zoom-in duration-500">
          <div className="bg-blue-600 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-blue-500/40">
            <PackageSearch size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter mb-2">HI AI SYSTEM</h1>
          <p className="text-slate-500 font-bold text-sm mb-10">한일공구사 스마트 재고 관리 시스템</p>
          
          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white py-4 rounded-2xl font-black text-sm hover:bg-slate-800 transition-all active:scale-95 shadow-xl"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Google 계정으로 시작하기
          </button>
          
          <p className="mt-8 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Authorized Personnel Only
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-white p-6 sticky top-0 h-screen shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-500/20">
            <PackageSearch size={24} />
          </div>
          <h1 className="text-xl font-black tracking-tighter uppercase">HI AI System</h1>
        </div>
        
        <nav className="space-y-2 flex-1">
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-bold bg-blue-600 text-white shadow-lg">
            <Database size={18} /> 통합 원장
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-800">
          <button 
            onClick={() => setShowKeySetting(true)} 
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white text-sm font-bold transition-all"
          >
            <Settings size={18} /> 시스템 설정
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 lg:p-8 w-full overflow-hidden">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight uppercase">HI AI Inventory</h2>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Hardware Intelligence Management</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={exportExcel} 
              className="flex-1 md:flex-none px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-50 shadow-sm transition-all"
            >
              <Download size={16} /> 엑셀 저장
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="flex-1 md:flex-none px-4 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-800 shadow-xl transition-all"
            >
              <Plus size={16} /> 업로드
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              accept="image/*" 
              onChange={handleFileUpload} 
            />
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          {[
            { label: '매입액', value: `₩${stats.purchase.toLocaleString()}`, color: 'text-blue-600' },
            { label: '매출액', value: `₩${stats.sales.toLocaleString()}`, color: 'text-orange-600' },
            { label: '브랜드', value: `${stats.brands}개`, color: 'text-slate-700' },
            { label: '매입처', value: `${stats.vendors}개`, color: 'text-indigo-600' },
            { label: '총 기록', value: `${stats.count}건`, color: 'text-slate-700' }
          ].map((s, idx) => (
            <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
              <h3 className={cn("text-sm lg:text-base font-black", s.color)}>{s.value}</h3>
            </div>
          ))}
        </div>

        {/* Filters & Search */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex bg-slate-200/50 p-1 rounded-xl shrink-0">
            {(['all', 'purchase', 'sales'] as const).map(t => (
              <button 
                key={t} 
                onClick={() => setFilterType(t)} 
                className={cn(
                  "px-5 py-2 rounded-lg text-xs font-black transition-all whitespace-nowrap",
                  filterType === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {t === 'all' ? '전체' : t === 'purchase' ? '매입' : '매출'}
              </button>
            ))}
          </div>
          
          <div className="relative flex-1 flex gap-2">
            <div className="relative flex-1">
              <input 
                type="text" 
                placeholder="품명, 날짜, 거래처 검색..." 
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
              />
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <Search size={18} />
              </div>
            </div>
            {selectedIds.length > 0 && (
              <button 
                onClick={handleBulkDelete}
                className="px-4 py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-black flex items-center gap-2 hover:bg-red-100 transition-colors shrink-0"
              >
                <Trash2 size={16} /> {selectedIds.length}개 삭제
              </button>
            )}
          </div>
        </div>

        {/* Table / List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <th className="px-4 py-4 text-center w-12">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={filtered.length > 0 && selectedIds.length === filtered.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-4 py-4 text-center w-20">구분</th>
                  <th className="px-4 py-4 w-24">날짜</th>
                  <th className="px-4 py-4 w-32">거래처</th>
                  <th className="px-4 py-4 w-24">브랜드</th>
                  <th className="px-4 py-4 min-w-[200px]">품명</th>
                  <th className="px-4 py-4 w-32">규격</th>
                  <th className="px-4 py-4 text-right w-24">단가</th>
                  <th className="px-4 py-4 text-center w-16">수량</th>
                  <th className="px-4 py-4 text-right w-28">금액</th>
                  <th className="px-4 py-4 text-center w-16">CTX</th>
                  <th className="px-4 py-4 text-center w-24">도구</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-sm font-medium">
                {filtered.map(item => (
                  <tr key={item.id} className={cn(
                    "hover:bg-slate-50/50 group transition-colors",
                    selectedIds.includes(item.id!) && "bg-blue-50/30"
                  )}>
                    <td className="px-4 py-4 text-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedIds.includes(item.id!)}
                        onChange={() => toggleSelectItem(item.id!)}
                      />
                    </td>
                    <td className="px-4 py-4 text-center whitespace-nowrap">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-black",
                        item.type === 'purchase' ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600"
                      )}>
                        {item.type === 'purchase' ? '매입' : '매출'}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-mono text-slate-500 font-bold text-xs">{item.date || '-'}</td>
                    <td className="px-4 py-4 text-slate-700 truncate max-w-[120px] text-xs" title={item.company}>{item.company}</td>
                    <td className="px-4 py-4 uppercase text-slate-400 font-bold tracking-tight text-[10px] truncate max-w-[80px]" title={item.brand}>{item.brand || '-'}</td>
                    <td className="px-4 py-4 font-semibold text-slate-900 text-xs truncate max-w-[250px]" title={item.name}>{item.name}</td>
                    <td className="px-4 py-4 text-blue-600/80 font-bold text-xs truncate max-w-[120px]" title={item.spec}>{item.spec}</td>
                    <td className="px-4 py-4 text-right text-xs">₩{(Number(item.price) || 0).toLocaleString()}</td>
                    <td className="px-4 py-4 text-center font-bold text-slate-600 text-xs">{item.quantity}</td>
                    <td className="px-4 py-4 text-right font-black text-slate-900 text-xs">
                      ₩{((Number(item.price) || 0) * (Number(item.quantity) || 0)).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {item.company?.includes('크레텍') ? (
                        <a 
                          href={`https://ctx.cretec.kr/CtxApp/ctx/selectPowerSearchList.do?prod_cd=${item.code}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg inline-block transition-transform hover:scale-110"
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button 
                          onClick={() => generateProductGuide(item)} 
                          className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="AI 가이드"
                        >
                          <Lightbulb size={16} />
                        </button>
                        <button 
                          onClick={() => setEditModal({ open: true, data: { ...item } })} 
                          className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                          title="수정"
                        >
                          <Pencil size={16} />
                        </button>
                        <button 
                          onClick={() => setDeleteConfirm({ open: true, id: item.id!, name: item.name })} 
                          className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile List View */}
          <div className="lg:hidden flex flex-col divide-y divide-slate-100">
            {filtered.map(item => (
              <div key={item.id} className={cn(
                "p-4 flex flex-col gap-3 transition-colors",
                selectedIds.includes(item.id!) && "bg-blue-50/30"
              )}>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mr-1"
                      checked={selectedIds.includes(item.id!)}
                      onChange={() => toggleSelectItem(item.id!)}
                    />
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-black",
                      item.type === 'purchase' ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600"
                    )}>
                      {item.type === 'purchase' ? '매입' : '매출'}
                    </span>
                    <span className="text-[11px] font-bold text-slate-400 font-mono">{item.date}</span>
                  </div>
                  <div className="flex gap-1">
                    {item.company?.includes('크레텍') && (
                      <a 
                        href={`https://ctx.cretec.kr/CtxApp/ctx/selectPowerSearchList.do?prod_cd=${item.code}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-2 text-blue-600 bg-blue-50 rounded-lg"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button onClick={() => setEditModal({ open: true, data: { ...item } })} className="p-2 text-slate-500 bg-slate-100 rounded-lg"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteConfirm({ open: true, id: item.id!, name: item.name })} className="p-2 text-red-500 bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="flex flex-col">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">{item.brand || '브랜드 불명'} · {item.company}</h4>
                  <h3 className="text-sm font-black text-slate-900 leading-tight">{item.name}</h3>
                  <p className="text-xs font-bold text-blue-600 mt-0.5">{item.spec}</p>
                </div>
                <div className="flex justify-between items-end">
                  <div className="text-[11px] text-slate-400 font-bold">수량 {item.quantity} · ₩{(item.price || 0).toLocaleString()}</div>
                  <div className="text-base font-black text-slate-900">₩{((item.price || 0) * (item.quantity || 0)).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="p-20 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-50 rounded-full text-slate-200 mb-4">
                <Database size={32} />
              </div>
              <p className="text-slate-400 font-bold tracking-tight">검색 결과가 없습니다.</p>
            </div>
          )}
        </div>
      </main>

      {/* --- Modals --- */}

      {/* Duplicate Check Modal */}
      {duplicateModal.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight">중복 데이터 감지</h3>
                  <p className="text-sm text-slate-500 font-medium">이미 등록된 데이터와 일치하는 항목이 있습니다.</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 mb-6 max-h-48 overflow-y-auto border border-slate-100">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">중복된 항목 ({duplicateModal.duplicates.length}건)</p>
                <div className="space-y-2">
                  {duplicateModal.duplicates.map((item, idx) => (
                    <div key={idx} className="text-xs font-bold text-slate-600 bg-white p-2 rounded-lg border border-slate-100">
                      {item.company} | {item.name} ({item.spec})
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => duplicateModal.resolve?.('exclude')}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                >
                  <Check size={18} /> 중복 제외하고 저장
                </button>
                <button 
                  onClick={() => duplicateModal.resolve?.('all')}
                  className="w-full bg-white border-2 border-slate-200 text-slate-700 py-4 rounded-2xl font-black text-sm transition-transform active:scale-95"
                >
                  모두 저장 (중복 허용)
                </button>
                <button 
                  onClick={() => duplicateModal.resolve?.('cancel')}
                  className="w-full bg-red-50 text-red-600 py-4 rounded-2xl font-black text-sm transition-transform active:scale-95"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showKeySetting && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in-95">
            <h3 className="text-xl font-black mb-6 flex items-center gap-2 text-slate-800 tracking-tight">
              <Settings /> 시스템 정보
            </h3>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <h4 className="text-sm font-black text-slate-800">AI 모델</h4>
                <p className="text-xs text-slate-500 mt-1 font-medium">Gemini 3 Flash Preview (System Managed)</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <h4 className="text-sm font-black text-slate-800">인증 상태</h4>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {user ? `${user.displayName || user.email} (${user.uid.slice(0, 8)}...)` : '로그인 중...'}
                </p>
              </div>
              <button 
                onClick={() => auth.signOut()} 
                className="w-full bg-red-50 text-red-600 py-4 rounded-2xl font-black text-sm transition-transform active:scale-95"
              >
                로그아웃
              </button>
              <button 
                onClick={() => setShowKeySetting(false)} 
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-lg transition-transform active:scale-95"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal.open && editModal.data && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-black tracking-tight text-slate-800">기록 수정</h3>
              <button onClick={() => setEditModal({ open: false, data: null })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">날짜</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={editModal.data.date} 
                    onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, date: e.target.value}})} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">유형</label>
                  <select 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={editModal.data.type} 
                    onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, type: e.target.value as InvoiceType}})}
                  >
                    <option value="purchase">매입</option>
                    <option value="sales">매출</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">거래처</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={editModal.data.company} 
                  onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, company: e.target.value}})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">브랜드</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={editModal.data.brand} 
                    onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, brand: e.target.value}})} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">제품코드</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={editModal.data.code} 
                    onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, code: e.target.value}})} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">품명</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={editModal.data.name} 
                  onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, name: e.target.value}})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">단가</label>
                  <input 
                    type="number" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={editModal.data.price} 
                    onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, price: Number(e.target.value)}})} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">수량</label>
                  <input 
                    type="number" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={editModal.data.quantity} 
                    onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, quantity: Number(e.target.value)}})} 
                  />
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button 
                onClick={handleSaveEdit} 
                className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-transform"
              >
                저장하기
              </button>
              <button 
                onClick={() => setEditModal({ open: false, data: null })} 
                className="flex-1 bg-white border border-slate-200 py-4 rounded-2xl font-black text-sm text-slate-500 active:scale-95 transition-transform"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[600] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8 text-center animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <Trash2 size={40} />
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-2">기록 삭제</h3>
            <p className="text-slate-500 text-sm font-medium mb-8">
              <span className="text-slate-900 font-bold">[{deleteConfirm.name}]</span><br />
              이 기록을 영구적으로 삭제하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  if (deleteConfirm.id === 'BULK_DELETE') {
                    executeBulkDelete();
                  } else {
                    handleDeleteItem();
                  }
                }} 
                className="flex-1 bg-red-500 text-white py-4 rounded-2xl font-black text-sm active:scale-95 transition-transform shadow-lg shadow-red-500/20"
              >
                삭제하기
              </button>
              <button 
                onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })} 
                className="flex-1 bg-slate-100 text-slate-500 py-4 rounded-2xl font-black text-sm active:scale-95 transition-transform"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-black tracking-tight text-slate-800">{modal.title}</h3>
              <button onClick={() => setModal({ ...modal, open: false })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 max-h-[60vh] overflow-y-auto text-sm leading-relaxed text-slate-600 font-medium whitespace-pre-wrap">
              {modal.content}
            </div>
            <div className="p-6 bg-slate-50/50 flex gap-3">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(modal.content);
                }} 
                className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-transform"
              >
                내용 복사
              </button>
              <button 
                onClick={() => setModal({ ...modal, open: false })} 
                className="flex-1 bg-white border border-slate-200 py-4 rounded-2xl font-black text-sm text-slate-500 active:scale-95 transition-transform"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processing Overlay */}
      {processingStatus.active && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[1000] flex items-center justify-center px-4">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl flex flex-col items-center gap-6 w-full max-w-sm animate-in zoom-in-95">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="text-center w-full">
              <h3 className="text-2xl font-black text-slate-900 mb-1">AI 분석 중...</h3>
              <p className="text-slate-500 text-xs font-bold mb-4">명세서 이미지를 데이터로 변환하고 있습니다.</p>
              <div className="text-4xl font-black text-blue-600 mb-4 font-mono tracking-tighter">
                {processingStatus.current} / {processingStatus.total}
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                <div 
                  className="h-full bg-blue-600 transition-all duration-500 rounded-full" 
                  style={{ width: `${(processingStatus.current / processingStatus.total) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-[2px] z-[1200] flex items-center justify-center">
          <div className="bg-slate-900 text-white px-6 py-4 rounded-2xl flex items-center gap-3 shadow-2xl animate-pulse">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            <span className="text-xs font-black uppercase tracking-widest">실행 중...</span>
          </div>
        </div>
      )}
    </div>
  );
}

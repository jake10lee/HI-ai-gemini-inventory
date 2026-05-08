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
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  Cell
} from 'recharts';
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  subDays, 
  addDays,
  startOfMonth, 
  endOfMonth, 
  eachMonthOfInterval, 
  startOfYear, 
  endOfYear,
  subMonths,
  addMonths,
  subYears,
  addYears,
  isWithinInterval, 
  parseISO,
  subWeeks,
  addWeeks
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { 
  LayoutDashboard,
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
  AlertTriangle,
  Menu,
  ArrowDownLeft,
  ArrowUpRight,
  Users,
  Target,
  ClipboardList,
  Calendar,
  Building2,
  Mail,
  Phone,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Network,
  TrendingUp,
  BarChart3
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { db, auth } from './lib/firebase';
import { cn } from './lib/utils';
import { InventoryItem, ProcessingStatus, InvoiceType, Vendor, TodoItem, VisionGoal } from './types';

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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'vendors' | 'todo' | 'vision'>('dashboard');
  const [filterType, setFilterType] = useState<'all' | InvoiceType>('all');
  
  // Dashboard State
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [visions, setVisions] = useState<VisionGoal[]>([]);
  
  const [vendorSort, setVendorSort] = useState<'name' | 'latest'>('name');
  const [showOrgChart, setShowOrgChart] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<'weekly' | 'monthly' | 'yearly' | 'all'>('weekly');
  const [activeDate, setActiveDate] = useState(new Date());
  
  const [vendorModal, setVendorModal] = useState<{ open: boolean; data: Partial<Vendor> | null }>({ open: false, data: null });
  const [todoModal, setTodoModal] = useState<{ open: boolean; data: Partial<TodoItem> | null }>({ open: false, data: null });
  const [visionModal, setVisionModal] = useState<{ open: boolean; data: Partial<VisionGoal> | null }>({ open: false, data: null });

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini-3-flash-preview' | 'gemini-3.1-flash-lite-preview'>('gemini-3-flash-preview');
  const [manualAddModal, setManualAddModal] = useState<{ open: boolean; data: Partial<InventoryItem> }>({ 
    open: false, 
    data: {
      type: 'purchase',
      date: new Date().toISOString().split('T')[0],
      company: '',
      brand: '',
      name: '',
      spec: '',
      code: '',
      quantity: 1,
      price: 0,
      unit: 'EA'
    } 
  });

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
    const q = query(inventoryRef, orderBy('date', 'desc'), orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventory');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Vendors Sync Effect
  useEffect(() => {
    if (!isAuthReady || !user) return;
    const ref = collection(db, 'vendors');
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      setVendors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vendor)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'vendors'));
    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Todos Sync Effect
  useEffect(() => {
    if (!isAuthReady || !user) return;
    const ref = collection(db, 'todos');
    const q = query(ref, orderBy('completed', 'asc'), orderBy('dueDate', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTodos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TodoItem)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'todos'));
    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Vision Sync Effect
  useEffect(() => {
    if (!isAuthReady || !user) return;
    const ref = collection(db, 'visions');
    const q = query(ref, orderBy('date', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setVisions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VisionGoal)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'visions'));
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
          model: selectedModel,
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
            4. PRODUCT CODE: Look for strings like '104-4621' or 'XXX-XXXX' (품목코드/모델번호).
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

  const handleManualAdd = async () => {
    if (!manualAddModal.data.name || !user) return;
    setLoading(true);
    try {
      const inventoryRef = collection(db, 'inventory');
      await addDoc(inventoryRef, {
        ...manualAddModal.data,
        timestamp: serverTimestamp()
      });
      setManualAddModal({ ...manualAddModal, open: false });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'inventory');
    } finally {
      setLoading(false);
    }
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

  const handleViewCtx = (item: InventoryItem) => {
    if (item.ctxLink) {
      window.open(item.ctxLink, '_blank');
      return;
    }
    
    // Check if code or spec looks like a Cretec product code (e.g., 104-4621)
    const codePattern = /^\d{3,}-\d{4,}$/;
    const targetCode = codePattern.test(item.code) ? item.code : (codePattern.test(item.spec) ? item.spec : null);

    if (targetCode) {
      window.open(`https://ctx.cretec.kr/CtxApp/ctx/selectPowerSearchList.do?prod_cd=${encodeURIComponent(targetCode)}`, '_blank');
    } else {
      // Fallback to Google search with cretec domain context
      const query = `${item.brand} ${item.name} ${item.spec} site:cretec.kr`;
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
    }
  };

  const handleVisionAction = async (action: 'save' | 'delete', data: Partial<VisionGoal>) => {
    if (!user) return;
    setLoading(true);
    try {
      if (action === 'delete') {
        if (data.id) await deleteDoc(doc(db, 'visions', data.id));
      } else {
        if (data.id) {
          await updateDoc(doc(db, 'visions', data.id), data as any);
        } else {
          await addDoc(collection(db, 'visions'), { ...data, timestamp: serverTimestamp() });
        }
      }
      setVisionModal({ open: false, data: null });
    } catch (e) { handleFirestoreError(e, action === 'delete' ? OperationType.DELETE : OperationType.WRITE, 'visions'); }
    finally { setLoading(false); }
  };

  const handleVendorAction = async (action: 'save' | 'delete', data: Partial<Vendor>) => {
    if (!user) return;
    setLoading(true);
    try {
      if (action === 'delete') {
        if (data.id) await deleteDoc(doc(db, 'vendors', data.id));
      } else {
        if (!data.name) throw new Error('거래처명은 필수 입력 사항입니다.');

        const cleanedData = {
          name: data.name,
          orgChart: data.orgChart || '',
          contacts: (data.contacts || []).map(contact => ({
            name: contact.name || '',
            position: contact.position || '',
            phones: (contact.phones || []).filter(p => p.trim() !== ''),
            emails: (contact.emails || []).filter(e => e.trim() !== '')
          })),
          timestamp: data.id ? data.timestamp : serverTimestamp()
        };

        if (data.id) {
          const { timestamp, ...updatePayload } = cleanedData;
          await updateDoc(doc(db, 'vendors', data.id), updatePayload);
        } else {
          await addDoc(collection(db, 'vendors'), cleanedData);
        }
      }
      setVendorModal({ open: false, data: null });
    } catch (e) { 
      handleFirestoreError(e, action === 'delete' ? OperationType.DELETE : OperationType.WRITE, 'vendors'); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleTodoAction = async (action: 'save' | 'delete' | 'toggle', data: Partial<TodoItem>) => {
    if (!user) return;
    setLoading(true);
    try {
      if (action === 'delete') {
        if (data.id) await deleteDoc(doc(db, 'todos', data.id));
      } else if (action === 'toggle') {
        if (data.id) await updateDoc(doc(db, 'todos', data.id), { completed: !data.completed });
      } else {
        if (data.id) {
          await updateDoc(doc(db, 'todos', data.id), data as any);
        } else {
          await addDoc(collection(db, 'todos'), { ...data, completed: false, timestamp: serverTimestamp() });
        }
      }
      setTodoModal({ open: false, data: null });
    } catch (e) { handleFirestoreError(e, action === 'delete' ? OperationType.DELETE : OperationType.WRITE, 'todos'); }
    finally { setLoading(false); }
  };

  const handleUpdateSearchQuery = (query: string) => {
    setSearchQuery(query);
    setActiveTab('inventory');
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
    
    let sortedVendors = [...vendors];
    if (vendorSort === 'name') {
      sortedVendors.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    } else {
      sortedVendors.sort((a, b) => {
        const timeA = a.timestamp?.seconds || 0;
        const timeB = b.timestamp?.seconds || 0;
        return timeB - timeA;
      });
    }

    // Interval Calculation
    let intervalStart: Date;
    let intervalEnd: Date;
    let intervalLabel: string;
    
    if (chartPeriod === 'weekly') {
      intervalStart = startOfWeek(activeDate, { weekStartsOn: 1 });
      intervalEnd = endOfWeek(activeDate, { weekStartsOn: 1 });
      intervalLabel = `${format(intervalStart, 'yyyy.MM.dd')} ~ ${format(intervalEnd, 'yyyy.MM.dd')}`;
    } else if (chartPeriod === 'monthly') {
      intervalStart = startOfMonth(activeDate);
      intervalEnd = endOfMonth(activeDate);
      intervalLabel = `${format(intervalStart, 'yyyy.MM.dd')} ~ ${format(intervalEnd, 'yyyy.MM.dd')}`;
    } else if (chartPeriod === 'yearly') {
      intervalStart = startOfYear(activeDate);
      intervalEnd = endOfYear(activeDate);
      intervalLabel = `${format(intervalStart, 'yyyy.MM.dd')} ~ ${format(intervalEnd, 'yyyy.MM.dd')}`;
    } else {
      // 'all' period
      const dates = inventory.map(i => parseISO(i.date)).sort((a, b) => a.getTime() - b.getTime());
      intervalStart = dates.length > 0 ? dates[0] : subDays(new Date(), 30);
      intervalEnd = new Date();
      intervalLabel = "전체 기간 현황";
    }

    // Filter Items by Interval
    const periodPurchaseItems = chartPeriod === 'all' ? pItems : pItems.filter(item => {
      const d = parseISO(item.date);
      return isWithinInterval(d, { start: intervalStart, end: intervalEnd });
    });
    const periodSalesItems = chartPeriod === 'all' ? sItems : sItems.filter(item => {
      const d = parseISO(item.date);
      return isWithinInterval(d, { start: intervalStart, end: intervalEnd });
    });

    // Chart Data Generation
    let chartData: any[] = [];
    
    if (chartPeriod === 'weekly') {
      chartData = eachDayOfInterval({ start: intervalStart, end: intervalEnd }).map(date => {
        const dStr = format(date, 'yyyy-MM-dd');
        return {
          name: format(date, 'E', { locale: ko }),
          fullDate: dStr,
          purchase: pItems.filter(i => i.date === dStr).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
          sales: sItems.filter(i => i.date === dStr).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
        };
      });
    } else if (chartPeriod === 'monthly') {
      chartData = eachDayOfInterval({ start: intervalStart, end: intervalEnd }).map(date => {
        const dStr = format(date, 'yyyy-MM-dd');
        return {
          name: format(date, 'd'),
          fullDate: dStr,
          purchase: pItems.filter(i => i.date === dStr).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
          sales: sItems.filter(i => i.date === dStr).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
        };
      });
    } else if (chartPeriod === 'yearly') {
      chartData = eachMonthOfInterval({ start: intervalStart, end: intervalEnd }).map(date => {
        const mStr = format(date, 'yyyy-MM');
        return {
          name: format(date, 'MMM', { locale: ko }),
          fullDate: mStr,
          purchase: pItems.filter(i => i.date?.startsWith(mStr)).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
          sales: sItems.filter(i => i.date?.startsWith(mStr)).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
        };
      } );
    } else {
      // 'all' period grouping by month for meaningful visualization
      chartData = eachMonthOfInterval({ start: intervalStart, end: intervalEnd }).map(date => {
        const mStr = format(date, 'yyyy-MM');
        return {
          name: format(date, 'yy/MM'),
          fullDate: mStr,
          purchase: pItems.filter(i => i.date?.startsWith(mStr)).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
          sales: sItems.filter(i => i.date?.startsWith(mStr)).reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
        };
      });
    }

    return { 
      purchase: periodPurchaseItems.reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0), 
      sales: periodSalesItems.reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
      totalPurchase: pItems.reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
      totalSales: sItems.reduce((a, c) => a + (Number(c.price) * Number(c.quantity) || 0), 0),
      purchaseCount: pItems.length,
      salesCount: sItems.length,
      brands: [...new Set(inventory.map(i => i.brand))].length,
      vendors: [...new Set(pItems.map(i => i.company))].length,
      count: inventory.length,
      todoCompletion: todos.length > 0 ? Math.round((todos.filter(t => t.completed).length / todos.length) * 100) : 0,
      sortedVendors,
      chartData,
      intervalLabel
    };
  }, [inventory, todos, vendors, vendorSort, chartPeriod, activeDate]);

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
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900 overflow-x-hidden">
      {/* Main Layout Container */}
      <div className="flex flex-1 gap-4 lg:gap-6 p-4 lg:p-6 max-h-screen overflow-hidden relative">
        {/* Mobile Menu Backdrop */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[1050] lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Left Sidebar Rail */}
        <aside className={cn(
          "fixed inset-y-4 left-4 z-[1100] w-20 bg-white rounded-5xl flex flex-col items-center py-10 shadow-clay transition-all duration-300 lg:relative lg:inset-auto lg:translate-x-0 lg:z-auto shrink-0",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-[calc(100%+32px)]"
        )}>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className="bg-orange-500 p-3 rounded-2xl shadow-lg shadow-orange-500/20 mb-12 hover:scale-110 active:scale-95 transition-all cursor-pointer"
          >
            <PackageSearch size={24} className="text-white" />
          </button>
          
          <nav className="flex flex-col gap-6">
            <button 
              onClick={() => setActiveTab('inventory')}
              className={cn(
                "p-4 rounded-2xl transition-all group relative",
                activeTab === 'inventory' ? "bg-slate-900 text-white shadow-lg" : "bg-white text-slate-400 hover:text-slate-900 border border-slate-100"
              )}
              title="재고관리"
            >
              <Database size={22} className="group-hover:scale-110 transition-transform" />
              {activeTab === 'inventory' && <div className="absolute left-[-24px] top-1/2 -translate-y-1/2 w-1.5 h-10 bg-slate-900 rounded-r-full" />}
            </button>

            <button 
              onClick={() => setActiveTab('vendors')}
              className={cn(
                "p-4 rounded-2xl transition-all group relative",
                activeTab === 'vendors' ? "bg-slate-900 text-white shadow-lg" : "bg-white text-slate-400 hover:text-slate-900 border border-slate-100"
              )}
              title="거래처 관리"
            >
              <Users size={22} className="group-hover:scale-110 transition-transform" />
              {activeTab === 'vendors' && <div className="absolute left-[-24px] top-1/2 -translate-y-1/2 w-1.5 h-10 bg-slate-900 rounded-r-full" />}
            </button>

            <button 
              onClick={() => setActiveTab('todo')}
              className={cn(
                "p-4 rounded-2xl transition-all group relative",
                activeTab === 'todo' ? "bg-slate-900 text-white shadow-lg" : "bg-white text-slate-400 hover:text-slate-900 border border-slate-100"
              )}
              title="TO-DO 리스트"
            >
              <ClipboardList size={22} className="group-hover:scale-110 transition-transform" />
              {activeTab === 'todo' && <div className="absolute left-[-24px] top-1/2 -translate-y-1/2 w-1.5 h-10 bg-slate-900 rounded-r-full" />}
            </button>

            <button 
              onClick={() => setActiveTab('vision')}
              className={cn(
                "p-4 rounded-2xl transition-all group relative",
                activeTab === 'vision' ? "bg-slate-900 text-white shadow-lg" : "bg-white text-slate-400 hover:text-slate-900 border border-slate-100"
              )}
              title="VISION & 목표"
            >
              <Target size={22} className="group-hover:scale-110 transition-transform" />
              {activeTab === 'vision' && <div className="absolute left-[-24px] top-1/2 -translate-y-1/2 w-1.5 h-10 bg-slate-900 rounded-r-full" />}
            </button>
          </nav>

          <div className="mt-auto flex flex-col gap-6">
            <button 
              onClick={() => setShowKeySetting(true)} 
              className="p-4 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"
              title="Settings"
            >
              <Settings size={22} />
            </button>
            <div className="w-10 h-10 rounded-full bg-slate-200 border-2 border-white shadow-sm overflow-hidden">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} alt="Avatar" />
            </div>
          </div>
        </aside>

        {/* Main Workspace Area */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
          {/* Top Bar Area */}
          <header className="flex items-center gap-6 shrink-0">
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-4 bg-white rounded-2xl shadow-clay lg:hidden"
            >
              <Menu size={24} />
            </button>

            <div className="flex-1 relative group">
              <input 
                type="text" 
                placeholder="검색..." 
                className="w-full pl-10 lg:pl-12 pr-10 lg:pr-12 py-3 lg:py-4 bg-white rounded-3xl lg:rounded-4xl text-xs lg:text-sm font-medium border-none shadow-clay outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
              />
              <Search className="absolute left-4 lg:left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" size={16} />
              <div className="absolute right-4 lg:right-5 top-1/2 -translate-y-1/2 flex items-center gap-2 lg:gap-3">
                <button 
                  onClick={exportExcel}
                  className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                  title="Excel Export"
                >
                  <Download size={16} />
                </button>
                <div className="w-[1px] h-3 bg-slate-200" />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-900 rounded-full transition-all"
                  title="Upload Image"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-3 bg-white p-2 rounded-4xl shadow-clay">
              <div className="px-4 py-2 flex flex-col items-end">
                <span className="text-[10px] font-black text-slate-400 uppercase leading-none">시스템</span>
                <span className="text-xs font-black text-slate-900 uppercase">운영 노드</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold ring-2 ring-offset-2 ring-slate-100">
                {user.displayName?.split(' ').map(n => n[0]).join('') || 'HI'}
              </div>
            </div>
          </header>

          {activeTab === 'dashboard' && (
            <div className="flex-1 grid grid-cols-12 gap-6 overflow-hidden pb-2">
              {/* Left Column: Financial Stats & Vendors */}
              <div className="col-span-12 lg:col-span-7 flex flex-col gap-4 lg:gap-6 overflow-hidden">
                {/* Financial Summary Card */}
                <section className="bg-white rounded-4xl lg:rounded-5xl p-6 lg:p-8 shadow-clay flex flex-col gap-6 shrink-0 border-t-8 border-blue-600">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-blue-600">
                        <BarChart3 size={20} className="lg:w-6 lg:h-6" />
                        <h3 className="text-lg lg:text-xl font-black tracking-tight text-slate-900 leading-none">매출입 현황</h3>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stats.intervalLabel}</span>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="text-right">
                        <div className="text-[9px] font-black text-blue-500 uppercase tracking-tighter">누적 매입</div>
                        <div className="text-sm lg:text-lg font-black text-slate-900">₩{stats.totalPurchase.toLocaleString()}</div>
                      </div>
                      <div className="w-[1px] h-8 bg-slate-100" />
                      <div className="text-right">
                        <div className="text-[9px] font-black text-orange-500 uppercase tracking-tighter">누적 매출</div>
                        <div className="text-sm lg:text-lg font-black text-slate-900">₩{stats.totalSales.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Charts Section */}
                  <div className="flex-1 min-h-[250px] lg:min-h-[300px] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="flex bg-slate-50 p-1 rounded-xl mr-2">
                          {['weekly', 'monthly', 'yearly', 'all'].map((period) => (
                             <button 
                               key={period}
                               onClick={() => {
                                 setChartPeriod(period as any);
                                 setActiveDate(new Date());
                               }}
                               className={cn(
                                 "px-4 py-1.5 text-[10px] font-black rounded-lg transition-all",
                                 chartPeriod === period ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                               )}
                             >
                               {period === 'weekly' ? '주간' : period === 'monthly' ? '월간' : period === 'yearly' ? '연간' : '전체'}
                             </button>
                          ))}
                        </div>
                        {chartPeriod !== 'all' && (
                          <button 
                            onClick={() => setActiveDate(new Date())}
                            className="px-3 py-1.5 bg-slate-100 text-[10px] font-black text-slate-500 rounded-lg hover:bg-slate-200 transition-colors"
                          >현재</button>
                        )}
                      </div>

                      {chartPeriod !== 'all' && (
                        <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl">
                          <button 
                            onClick={() => {
                              if (chartPeriod === 'weekly') setActiveDate(subWeeks(activeDate, 1));
                              else if (chartPeriod === 'monthly') setActiveDate(subMonths(activeDate, 1));
                              else setActiveDate(subYears(activeDate, 1));
                            }}
                            className="p-1.5 hover:bg-white rounded-lg transition-all text-slate-400 hover:text-slate-900"
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <span className="text-[10px] font-black text-slate-900 px-2 min-w-[60px] text-center">
                            {chartPeriod === 'weekly' ? format(activeDate, 'M월 w주', { locale: ko }) : 
                             chartPeriod === 'monthly' ? format(activeDate, 'yyyy년 M월', { locale: ko }) : 
                             format(activeDate, 'yyyy년', { locale: ko })}
                          </span>
                          <button 
                            onClick={() => {
                              if (chartPeriod === 'weekly') setActiveDate(addWeeks(activeDate, 1));
                              else if (chartPeriod === 'monthly') setActiveDate(addMonths(activeDate, 1));
                              else setActiveDate(addYears(activeDate, 1));
                            }}
                            className="p-1.5 hover:bg-white rounded-lg transition-all text-slate-400 hover:text-slate-900"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="h-[200px] lg:h-[240px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.chartData} barGap={4}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                            dy={10}
                          />
                          <YAxis hide />
                          <RechartsTooltip 
                            cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }}
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 'bold' }}
                            formatter={(value: any) => `₩${Number(value).toLocaleString()}`}
                          />
                          <Bar 
                            dataKey="purchase" 
                            name="매입"
                            fill="#3b82f6" 
                            radius={[4, 4, 0, 0]} 
                            barSize={chartPeriod === 'weekly' ? 30 : chartPeriod === 'monthly' ? 12 : 40}
                          />
                          <Bar 
                            dataKey="sales" 
                            name="매출"
                            fill="#f97316" 
                            radius={[4, 4, 0, 0]} 
                            barSize={chartPeriod === 'weekly' ? 30 : chartPeriod === 'monthly' ? 12 : 40}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="flex items-center justify-center gap-6 mt-4 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        <span className="text-[10px] font-black text-slate-400 uppercase">매입</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                        <span className="text-[10px] font-black text-slate-400 uppercase">매출</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Vendors Ledger */}
                <section className="flex-1 bg-white rounded-4xl lg:rounded-5xl p-6 lg:p-8 shadow-clay flex flex-col gap-4 lg:gap-6 overflow-hidden">
                  <div className="flex justify-between items-center shrink-0 cursor-pointer" onClick={() => setActiveTab('vendors')}>
                    <div className="flex items-center gap-2 lg:gap-3 text-orange-500">
                      <Users size={20} className="lg:w-6 lg:h-6" />
                      <h3 className="text-lg lg:text-xl font-black tracking-tight text-slate-900 leading-none">주요 거래처 현황</h3>
                    </div>
                    <button className="text-[10px] font-black text-slate-400 uppercase hover:text-orange-500 transition-colors">전체보기</button>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 lg:space-y-4">
                    {vendors.map(vendor => (
                      <div key={vendor.id} className="p-4 lg:p-5 bg-white border-2 border-slate-50 rounded-3xl lg:rounded-4xl hover:border-orange-200 transition-all flex items-center gap-3 lg:gap-4">
                        <div className="w-10 h-10 lg:w-12 lg:h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600 shrink-0">
                          <Building2 size={18} className="lg:w-[22px] lg:h-[22px]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs lg:text-sm font-black text-slate-900 uppercase tracking-tight truncate">{vendor.name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] lg:text-[10px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md truncate">{vendor.orgChart}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[9px] font-bold text-slate-500 block">담당자</span>
                          <span className="text-[10px] lg:text-xs font-black text-slate-900">
                            {vendor.contacts?.[0]?.name || 'N/A'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Right Column: To-Do */}
              <div className="col-span-12 lg:col-span-5 flex flex-col gap-6 overflow-hidden">
                <section className="flex-1 bg-white rounded-4xl lg:rounded-5xl p-6 lg:p-8 shadow-clay flex flex-col gap-4 lg:gap-6 overflow-hidden border-t-8 border-slate-900">
                  <div className="flex justify-between items-center cursor-pointer" onClick={() => setActiveTab('todo')}>
                    <div className="flex items-center gap-2 lg:gap-3">
                      <ClipboardList size={20} className="text-slate-900 lg:w-6 lg:h-6" />
                      <h3 className="text-lg lg:text-xl font-black tracking-tight">TO-DO 리스트</h3>
                    </div>
                    <button className="text-[10px] font-black text-slate-400 uppercase hover:text-slate-900 transition-colors">전체보기</button>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 lg:space-y-4">
                    {todos.map(todo => (
                      <div key={todo.id} className={cn(
                        "p-4 lg:p-5 rounded-3xl lg:rounded-4xl border-2 transition-all group",
                        todo.completed ? "bg-slate-50 border-transparent opacity-60" : "bg-white border-slate-50 hover:border-slate-200"
                      )}>
                        <div className="flex items-start gap-3 lg:gap-4">
                          <button 
                            onClick={() => handleTodoAction('toggle', todo)}
                            className={cn(
                            "w-5 h-5 lg:w-6 lg:h-6 rounded-lg border-2 flex items-center justify-center transition-all mt-0.5 lg:mt-1",
                            todo.completed ? "bg-slate-900 border-slate-900 text-white" : "border-slate-200 text-transparent hover:border-slate-900"
                          )}>
                            <Check size={12} className="lg:w-[14px] lg:h-[14px]" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={cn(
                                "text-[8px] lg:text-[9px] font-black px-2 py-0.5 rounded-full uppercase",
                                todo.priority === 'high' ? "bg-red-50 text-red-600" : 
                                todo.priority === 'medium' ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
                              )}>
                                {todo.priority}
                              </span>
                              <span className="text-[9px] lg:text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                <Calendar size={10} /> {todo.dueDate}
                              </span>
                            </div>
                            <h4 className={cn(
                              "text-xs lg:text-sm font-black tracking-tight leading-tight",
                              todo.completed ? "text-slate-400 line-through" : "text-slate-900"
                            )}>
                              {todo.task}
                            </h4>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-slate-900 rounded-4xl lg:rounded-5xl p-6 lg:p-8 shadow-clay text-white relative overflow-hidden h-32 lg:h-40 shrink-0">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                  <div className="relative z-10 h-full flex flex-col justify-center">
                    <h4 className="text-white/40 text-[9px] lg:text-[10px] font-black uppercase tracking-widest mb-1 lg:mb-2">운영상태 리포트</h4>
                    <div className="text-xl lg:text-3xl font-black tracking-tighter mb-2 lg:mb-4">정상 운영 중</div>
                    <div className="flex gap-3 lg:gap-4">
                      <div className="flex-1 p-2 lg:p-3 bg-white/10 rounded-xl lg:rounded-2xl">
                        <div className="text-[8px] lg:text-[9px] font-black text-white/40 uppercase mb-0.5">완료율</div>
                        <div className="text-sm lg:text-xl font-black">{stats.todoCompletion}%</div>
                      </div>
                      <div className="flex-1 p-2 lg:p-3 bg-white/10 rounded-xl lg:rounded-2xl">
                        <div className="text-[8px] lg:text-[9px] font-black text-white/40 uppercase mb-0.5">거래처</div>
                        <div className="text-sm lg:text-xl font-black">{vendors.length}</div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="flex-1 flex flex-col gap-6 overflow-hidden pb-4">
              {/* Image-Style Top Header Row */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black tracking-tighter text-slate-900 leading-none">HI 재고관리</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">HARDWARE INTELLIGENCE MANAGEMENT</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={exportExcel}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                  >
                    <Download size={14} /> 엑셀 저장
                  </button>
                  <button 
                    onClick={() => setManualAddModal({ ...manualAddModal, open: true })}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                  >
                    <Plus size={14} /> 수동 추가
                  </button>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-800 transition-all shadow-lg active:scale-95"
                  >
                    <Plus size={14} /> 업로드
                  </button>
                </div>
              </div>

              {/* Stats Cards Row (5 Cards) */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 shrink-0">
                {[
                  { label: '매입액', value: `₩${stats.purchase.toLocaleString()}`, color: 'text-blue-600' },
                  { label: '매출액', value: `₩${stats.sales.toLocaleString()}`, color: 'text-orange-600' },
                  { label: '브랜드', value: `${stats.brands}개`, color: 'text-slate-900' },
                  { label: '매입처', value: `${stats.vendors}개`, color: 'text-blue-600' },
                  { label: '총 기록', value: `${stats.count}건`, color: 'text-slate-900' }
                ].map((stat, i) => (
                  <div key={i} className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{stat.label}</span>
                    <span className={cn("text-lg font-black tracking-tighter", stat.color)}>{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* Filter & Search Row */}
              <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 items-center shrink-0">
                <div className="flex bg-slate-50 p-1 rounded-lg shrink-0 w-full md:w-auto">
                  <button 
                    onClick={() => setFilterType('all')}
                    className={cn(
                      "flex-1 md:flex-none px-5 py-1.5 text-[11px] font-bold rounded-md transition-all",
                      filterType === 'all' ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-100" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    전체
                  </button>
                  <button 
                    onClick={() => setFilterType('purchase')}
                    className={cn(
                      "flex-1 md:flex-none px-5 py-1.5 text-[11px] font-bold rounded-md transition-all",
                      filterType === 'purchase' ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-100" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    매입
                  </button>
                  <button 
                    onClick={() => setFilterType('sales')}
                    className={cn(
                      "flex-1 md:flex-none px-5 py-1.5 text-[11px] font-bold rounded-md transition-all",
                      filterType === 'sales' ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-100" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    매출
                  </button>
                </div>
                <div className="flex-1 relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                  <input 
                    type="text" 
                    placeholder="품명, 날짜, 거래처 검색..."
                    className="w-full bg-slate-50 border-none rounded-lg pl-10 pr-4 py-2 text-[11px] font-bold text-slate-900 outline-none focus:ring-1 focus:ring-slate-200"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Data Table Section */}
              <div className="flex-1 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-0">
                <div className="overflow-x-auto overflow-y-auto custom-scrollbar flex-1 relative">
                  <table className="w-full border-collapse min-w-[1200px]">
                    <thead className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur-md">
                      <tr className="border-b border-slate-100">
                        <th className="p-3 text-left w-12">
                          <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded border-slate-200 text-slate-900 focus:ring-slate-900"
                            checked={selectedIds.length === filtered.length && filtered.length > 0}
                            onChange={toggleSelectAll}
                          />
                        </th>
                        <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest w-16">구분</th>
                        <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest w-24">날짜</th>
                        <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest w-40">거래처</th>
                        <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest w-24">브랜드</th>
                        <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[200px]">품명</th>
                        <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[150px]">규격</th>
                        <th className="p-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-24">단가</th>
                        <th className="p-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-16">수량</th>
                        <th className="p-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-24">금액</th>
                        <th className="p-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest w-12">CTX</th>
                        <th className="p-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest w-20">도구</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filtered.map(item => (
                        <tr 
                          key={item.id} 
                          className={cn(
                            "group hover:bg-slate-50 transition-colors",
                            selectedIds.includes(item.id!) ? "bg-slate-50/50" : "bg-white"
                          )}
                        >
                          <td className="p-3">
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded border-slate-200 text-slate-900 focus:ring-slate-900"
                              checked={selectedIds.includes(item.id!)}
                              onChange={() => toggleSelectItem(item.id!)}
                            />
                          </td>
                          <td className="p-3">
                            <span className={cn(
                              "text-[10px] font-black px-2 py-0.5 rounded-md",
                              item.type === 'purchase' ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600"
                            )}>
                              {item.type === 'purchase' ? '매입' : '매출'}
                            </span>
                          </td>
                          <td className="p-3 text-[11px] font-bold text-slate-500 font-mono">{item.date}</td>
                          <td className="p-3 text-[11px] font-black text-slate-700 truncate max-w-[160px]">{item.company}</td>
                          <td className="p-3 text-[11px] font-bold text-slate-400 truncate max-w-[100px]">{item.brand}</td>
                          <td className="p-3 text-[11px] font-black text-slate-900">{item.name}</td>
                          <td className="p-3 text-[11px] font-bold text-blue-500 font-mono">{item.spec}</td>
                          <td className="p-3 text-right text-[11px] font-bold text-slate-500 font-mono">₩{(item.price || 0).toLocaleString()}</td>
                          <td className="p-3 text-right text-[11px] font-black text-slate-900">{item.quantity}</td>
                          <td className="p-3 text-right text-[11px] font-black text-slate-900 font-mono">₩{((item.price || 0) * (item.quantity || 0)).toLocaleString()}</td>
                          <td className="p-3 text-center">
                            <button 
                              onClick={() => handleViewCtx(item)}
                              className="text-blue-400 hover:text-blue-600 transition-colors"
                            >
                              <ExternalLink size={14} />
                            </button>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => generateProductGuide(item)} className="p-1 px-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-600 hover:text-white transition-all">
                                <Lightbulb size={12} />
                              </button>
                              <button onClick={() => setEditModal({ open: true, data: { ...item } })} className="p-1 px-1.5 bg-slate-100 text-slate-500 rounded-md hover:bg-slate-900 hover:text-white transition-all">
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => setDeleteConfirm({ open: true, id: item.id!, name: item.name })} className="p-1 px-1.5 bg-red-50 text-red-400 rounded-md hover:bg-red-500 hover:text-white transition-all">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <div className="py-20 flex flex-col items-center justify-center text-slate-300">
                       <Database size={40} className="mb-4 opacity-50" />
                       <p className="text-sm font-bold opacity-50 uppercase tracking-widest">No matching records found</p>
                    </div>
                  )}
                </div>

                {/* Bulk Action Footer */}
                {selectedIds.length > 0 && (
                  <div className="p-3 bg-slate-900 text-white flex items-center justify-between px-6 animate-in slide-in-from-bottom-4">
                    <span className="text-[11px] font-black uppercase tracking-widest">{selectedIds.length} items selected</span>
                    <div className="flex gap-2">
                       <button onClick={() => setSelectedIds([])} className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-black transition-all">취소</button>
                       <button onClick={handleBulkDelete} className="px-4 py-1.5 bg-red-500 hover:bg-red-600 rounded-lg text-[10px] font-black transition-all">선택 삭제</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'vendors' && (
            <div className="flex-1 flex flex-col gap-6 overflow-hidden pb-4">
              <div className="flex justify-between items-center shrink-0">
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black tracking-tighter text-slate-900 leading-none">거래처 관리</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Partners & Vendor Directory</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowOrgChart(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-black hover:bg-blue-100 transition-all"
                  >
                    <Network size={16} /> 조직도 보기
                  </button>
                  <button 
                    onClick={() => setVendorModal({ open: true, data: { name: '', orgChart: '', contacts: [{ name: '', position: '', phones: [''], emails: [''] }] } })}
                    className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black shadow-lg hover:bg-slate-800 transition-all"
                  >
                    <Plus size={16} /> 신규 거래처 등록
                  </button>
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-4 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm shrink-0">
                <div className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest ml-2">
                  <ArrowRight size={14} className="text-slate-200" /> Sort By
                </div>
                <div className="flex bg-slate-50 p-1 rounded-xl">
                  <button 
                    onClick={() => setVendorSort('name')}
                    className={cn(
                      "px-4 py-1.5 text-[10px] font-black rounded-lg transition-all",
                      vendorSort === 'name' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                    )}
                  >가나다순</button>
                  <button 
                    onClick={() => setVendorSort('latest')}
                    className={cn(
                      "px-4 py-1.5 text-[10px] font-black rounded-lg transition-all",
                      vendorSort === 'latest' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                    )}
                  >최신순</button>
                </div>
                <div className="ml-auto flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                  <Search size={14} className="text-slate-300" />
                  <input 
                    type="text" 
                    placeholder="거래처명 검색..." 
                    className="bg-transparent border-none outline-none text-xs font-bold text-slate-700 w-40"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {stats.sortedVendors.filter(v => v.name.toLowerCase().includes(searchQuery.toLowerCase())).map(vendor => (
                  <div key={vendor.id} className="bg-white p-6 rounded-4xl shadow-clay border-2 border-transparent hover:border-orange-200 transition-all group relative">
                    <div className="flex items-start justify-between mb-6">
                      <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600">
                        <Building2 size={24} />
                      </div>
                      <div className="flex gap-1">
                        <button 
                          onClick={() => setVendorModal({ open: true, data: vendor })}
                          className="p-2 text-slate-300 hover:text-slate-900 transition-colors"
                        >
                          <Pencil size={18} />
                        </button>
                        <button 
                          onClick={() => handleVendorAction('delete', vendor)}
                          className="p-2 text-slate-300 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="mb-4">
                      <h3 className="text-lg font-black text-slate-900 mb-1">{vendor.name}</h3>
                      <span className="text-[9px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">{vendor.orgChart}</span>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-slate-50">
                      {vendor.contacts?.length > 0 ? (
                        vendor.contacts.map((contact, idx) => (
                          <div key={idx} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-black text-slate-800">{contact.name}</span>
                              <span className="text-[10px] font-bold text-slate-400">{contact.position}</span>
                            </div>
                            <div className="space-y-1">
                              {contact.phones?.map((p, pIdx) => p && (
                                <div key={pIdx} className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                  <Phone size={10} className="text-slate-300" /> {p}
                                </div>
                              ))}
                              {contact.emails?.map((e, eIdx) => e && (
                                <div key={eIdx} className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                  <Mail size={10} className="text-slate-300" /> {e}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] font-bold text-slate-300 text-center py-4 italic">No contact information</p>
                      )}
                    </div>
                    
                    <div className="mt-8">
                       <button 
                         onClick={() => handleUpdateSearchQuery(`company:${vendor.name}`)}
                         className="w-full py-3 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all shadow-lg active:scale-95"
                       >매입 이력 보기</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'todo' && (
            <div className="flex-1 flex flex-col gap-6 overflow-hidden pb-4">
              <div className="flex justify-between items-center shrink-0">
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black tracking-tighter text-slate-900 leading-none">TO-DO 리스트</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Operational Task Tracking</p>
                </div>
                <button 
                  onClick={() => setTodoModal({ open: true, data: { task: '', priority: 'medium', dueDate: new Date().toISOString().split('T')[0] } })}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black shadow-lg hover:bg-slate-800 transition-all"
                >
                  <Plus size={16} /> 할 일 추가
                </button>
              </div>
              <div className="flex-1 bg-white rounded-5xl shadow-clay p-8 overflow-hidden flex flex-col gap-6">
                <div className="flex gap-4 border-b border-slate-100 pb-4">
                  <button className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-black">전체 ({todos.length})</button>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                  {todos.map(todo => (
                    <div key={todo.id} className={cn(
                      "p-6 rounded-4xl border-2 transition-all group flex items-center gap-6",
                      todo.completed ? "bg-slate-50 border-transparent opacity-60" : "bg-white border-slate-100 hover:border-slate-300"
                    )}>
                      <button 
                        onClick={() => handleTodoAction('toggle', todo)}
                        className={cn(
                        "w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all shrink-0",
                        todo.completed ? "bg-slate-900 border-slate-900 text-white" : "border-slate-200 text-transparent hover:border-slate-900"
                      )}>
                        <Check size={16} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className={cn(
                            "text-[10px] font-black px-2 py-0.5 rounded-full uppercase",
                            todo.priority === 'high' ? "bg-red-50 text-red-600" : 
                            todo.priority === 'medium' ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
                          )}>
                            {todo.priority} PRIORITY
                          </span>
                          <span className="text-xs font-black text-slate-400 flex items-center gap-1.5 ml-auto">
                            <Calendar size={14} /> 기한: {todo.dueDate}
                          </span>
                        </div>
                        <h4 className={cn(
                          "text-lg font-black tracking-tight",
                          todo.completed ? "text-slate-400 line-through" : "text-slate-900"
                        )}>
                          {todo.task}
                        </h4>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setTodoModal({ open: true, data: todo })}
                          className="p-2 text-slate-300 hover:text-slate-900 transition-colors"
                        ><Pencil size={18} /></button>
                        <button 
                          onClick={() => handleTodoAction('delete', todo)}
                          className="p-2 text-slate-300 hover:text-red-600 transition-colors"
                        ><Trash2 size={18} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'vision' && (
            <div className="flex-1 flex flex-col gap-6 overflow-hidden pb-4">
              <div className="flex justify-between items-center shrink-0">
                <div className="flex flex-col">
                  <h2 className="text-3xl font-black tracking-tighter text-slate-900 leading-none">VISION & 목표</h2>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Strategic Roadmap 2024-2025</p>
                </div>
                <button 
                  onClick={() => setVisionModal({ open: true, data: { title: '', description: '', date: new Date().toISOString().split('T')[0].slice(0, 7) } })}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black shadow-lg hover:bg-slate-800 transition-all"
                >
                  <Plus size={16} /> 목표 추가
                </button>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {visions.map((vision, idx) => (
                    <div key={vision.id} className="bg-white p-8 lg:p-10 rounded-5xl shadow-clay border-t-8 border-blue-600 flex flex-col gap-6 group relative">
                      <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                        <button onClick={() => setVisionModal({ open: true, data: vision })} className="p-2 text-slate-400 hover:text-slate-900"><Pencil size={18} /></button>
                        <button onClick={() => handleVisionAction('delete', vision)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={18} /></button>
                      </div>
                      <div className="flex justify-between items-start">
                        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                          {idx === 0 ? <Building2 size={32} /> : <Target size={32} />}
                        </div>
                        <span className="text-2xl font-black text-slate-200 font-mono italic">#{idx + 1}</span>
                      </div>
                      <div>
                        <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest">Target: {vision.date}</span>
                        <h3 className="text-2xl font-black text-slate-900 mt-4 mb-4 tracking-tight">{vision.title}</h3>
                        <p className="text-base text-slate-500 font-bold leading-relaxed">{vision.description}</p>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="px-3 py-1 bg-slate-50 rounded-lg text-[10px] font-black text-slate-400 capitalize">Efficiency</span>
                        <span className="px-3 py-1 bg-slate-50 rounded-lg text-[10px] font-black text-slate-400 capitalize">Growth</span>
                        <span className="px-3 py-1 bg-slate-50 rounded-lg text-[10px] font-black text-slate-400 capitalize">Modernization</span>
                      </div>
                    </div>
                  ))}
                </div>
                <section className="bg-slate-900 rounded-5xl p-10 lg:p-12 text-white overflow-hidden relative shadow-2xl">
                  <div className="absolute right-[-10%] top-[-10%] w-64 h-64 bg-white/5 rounded-full blur-3xl" />
                  <div className="relative z-10 flex flex-col gap-6 max-w-2xl">
                    <div className="inline-flex items-center gap-3 text-blue-400">
                      <Lightbulb size={24} />
                      <span className="text-sm font-black uppercase tracking-widest">Strategy Keynote</span>
                    </div>
                    <h3 className="text-3xl lg:text-4xl font-black tracking-tighter leading-tight">HARDWARE INTELLIGENCE 로의 도약</h3>
                    <p className="text-lg text-white/60 font-bold leading-relaxed">
                      단순한 도매 유통을 넘어, 데이터 기반의 재고 관리와 지능형 물류 시스템을 구축하여 업계의 표준을 제시합니다.
                      우리의 비전은 모든 하드웨어 유통 과정의 디지털 전환을 선도하는 것입니다.
                    </p>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- Modals --- */}

      {/* Duplicate Check Modal */}
      {duplicateModal.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-4xl lg:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 lg:p-8">
              <div className="flex items-center gap-3 lg:gap-4 mb-4 lg:mb-6">
                <div className="w-10 h-10 lg:w-12 lg:h-12 bg-orange-100 text-orange-600 rounded-xl lg:rounded-2xl flex items-center justify-center shrink-0">
                  <AlertTriangle size={20} className="lg:w-6 lg:h-6" />
                </div>
                <div>
                  <h3 className="text-lg lg:text-xl font-black text-slate-800 tracking-tight">중복 데이터 감지</h3>
                  <p className="text-[11px] lg:text-sm text-slate-500 font-medium leading-tight">이미 등록된 일치 항목이 존재합니다.</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 mb-6 max-h-40 lg:max-h-48 overflow-y-auto border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">중복된 항목 ({duplicateModal.duplicates.length}건)</p>
                <div className="space-y-2">
                  {duplicateModal.duplicates.map((item, idx) => (
                    <div key={idx} className="text-[10px] font-bold text-slate-600 bg-white p-2 rounded-lg border border-slate-100 truncate">
                      {item.company} | {item.name} ({item.spec})
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 lg:gap-3">
                <button 
                  onClick={() => duplicateModal.resolve?.('exclude')}
                  className="w-full bg-slate-900 text-white py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                >
                  <Check size={16} /> 중복 제외하고 저장
                </button>
                <button 
                  onClick={() => duplicateModal.resolve?.('all')}
                  className="w-full bg-white border-2 border-slate-200 text-slate-700 py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm transition-transform active:scale-95"
                >
                  모두 저장 (중복 허용)
                </button>
                <button 
                  onClick={() => duplicateModal.resolve?.('cancel')}
                  className="w-full text-slate-400 text-[10px] font-black uppercase mt-2 hover:text-slate-600 transition-colors"
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
                <h4 className="text-sm font-black text-slate-800 mb-2">AI 모델 선택</h4>
                <select 
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value as any)}
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash (Standard)</option>
                  <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Fast)</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-2 font-medium leading-relaxed">
                  * Flash Lite는 속도가 빠르지만 복잡한 명세서 분석 시 정확도가 다소 낮을 수 있습니다.
                </p>
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

      {/* Manual Add Modal */}
      {manualAddModal.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-4xl lg:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-4 lg:p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-base lg:text-lg font-black tracking-tight text-slate-800">수동 데이터 추가</h3>
              <button onClick={() => setManualAddModal({ ...manualAddModal, open: false })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={18} className="lg:w-5 lg:h-5" />
              </button>
            </div>
            <div className="p-4 lg:p-6 max-h-[70vh] overflow-y-auto space-y-3 lg:space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">날짜</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={manualAddModal.data.date} 
                    onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, date: e.target.value } })} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">유형</label>
                  <select 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={manualAddModal.data.type} 
                    onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, type: e.target.value as InvoiceType } })}
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
                  placeholder="거래처명을 입력하세요"
                  value={manualAddModal.data.company} 
                  onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, company: e.target.value } })} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">브랜드</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={manualAddModal.data.brand} 
                    onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, brand: e.target.value } })} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">제품코드</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={manualAddModal.data.code} 
                    onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, code: e.target.value } })} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">품명</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  placeholder="품명을 입력하세요"
                  value={manualAddModal.data.name} 
                  onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, name: e.target.value } })} 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">규격</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={manualAddModal.data.spec} 
                  onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, spec: e.target.value } })} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">단가</label>
                  <input 
                    type="number" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={manualAddModal.data.price} 
                    onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, price: Number(e.target.value) } })} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-1">수량</label>
                  <input 
                    type="number" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={manualAddModal.data.quantity} 
                    onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, quantity: Number(e.target.value) } })} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">CTX 링크</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  placeholder="URL (선택사항)"
                  value={manualAddModal.data.ctxLink || ''} 
                  onChange={(e) => setManualAddModal({ ...manualAddModal, data: { ...manualAddModal.data, ctxLink: e.target.value } })} 
                />
              </div>
            </div>
            <div className="p-4 lg:p-6 bg-slate-50 flex gap-2 lg:gap-3">
              <button 
                onClick={handleManualAdd} 
                className="flex-1 bg-slate-900 text-white py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm shadow-xl active:scale-95 transition-transform"
              >
                추가하기
              </button>
              <button 
                onClick={() => setManualAddModal({ ...manualAddModal, open: false })} 
                className="flex-1 bg-white border border-slate-200 py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm text-slate-500 active:scale-95 transition-transform"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal.open && editModal.data && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-4xl lg:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-4 lg:p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-base lg:text-lg font-black tracking-tight text-slate-800">기록 수정</h3>
              <button onClick={() => setEditModal({ open: false, data: null })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={18} className="lg:w-5 lg:h-5" />
              </button>
            </div>
            <div className="p-4 lg:p-6 max-h-[70vh] overflow-y-auto space-y-3 lg:space-y-4">
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
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">규격</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={editModal.data.spec} 
                  onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, spec: e.target.value}})} 
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
              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-1">CTX 링크</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  placeholder="URL (선택사항)"
                  value={editModal.data.ctxLink || ''} 
                  onChange={(e) => setEditModal({...editModal, data: {...editModal.data!, ctxLink: e.target.value}})} 
                />
              </div>
            </div>
            <div className="p-4 lg:p-6 bg-slate-50 flex gap-2 lg:gap-3">
              <button 
                onClick={handleSaveEdit} 
                className="flex-1 bg-slate-900 text-white py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm shadow-xl active:scale-95 transition-transform"
              >
                저장하기
              </button>
              <button 
                onClick={() => setEditModal({ open: false, data: null })} 
                className="flex-1 bg-white border border-slate-200 py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm text-slate-500 active:scale-95 transition-transform"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1150] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-6 lg:p-8 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 lg:w-20 lg:h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 lg:mb-6">
              <Trash2 size={32} className="lg:w-10 lg:h-10" />
            </div>
            <h3 className="text-xl lg:text-2xl font-black text-slate-900 mb-2">기록 삭제</h3>
            <p className="text-slate-500 text-xs lg:text-sm font-medium mb-6 lg:mb-8">
              <span className="text-slate-900 font-bold">[{deleteConfirm.name}]</span><br />
              이 기록을 영구적으로 삭제하시겠습니까?
            </p>
            <div className="flex gap-2 lg:gap-3">
              <button 
                onClick={() => {
                  if (deleteConfirm.id === 'BULK_DELETE') {
                    executeBulkDelete();
                  } else {
                    handleDeleteItem();
                  }
                }} 
                className="flex-1 bg-red-500 text-white py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm active:scale-95 transition-transform shadow-lg shadow-red-500/20"
              >
                삭제하기
              </button>
              <button 
                onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })} 
                className="flex-1 bg-slate-100 text-slate-500 py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm active:scale-95 transition-transform"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-4xl lg:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-4 lg:p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-base lg:text-lg font-black tracking-tight text-slate-800">{modal.title}</h3>
              <button onClick={() => setModal({ ...modal, open: false })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={18} className="lg:w-5 lg:h-5" />
              </button>
            </div>
            <div className="p-6 lg:p-8 max-h-[60vh] lg:max-h-[70vh] overflow-y-auto text-[11px] lg:text-sm leading-relaxed text-slate-600 font-medium whitespace-pre-wrap">
              {modal.content}
            </div>
            <div className="p-4 lg:p-6 bg-slate-50/50 flex gap-2 lg:gap-3">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(modal.content);
                }} 
                className="flex-1 bg-slate-900 text-white py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm shadow-xl active:scale-95 transition-transform"
              >
                내용 복사
              </button>
              <button 
                onClick={() => setModal({ ...modal, open: false })} 
                className="flex-1 bg-white border border-slate-200 py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm text-slate-500 active:scale-95 transition-transform"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Modal */}
      {vendorModal.open && vendorModal.data && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-4xl shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between shrink-0">
              <h3 className="text-lg font-black text-slate-800">거래처 정보 상세 관리</h3>
              <button onClick={() => setVendorModal({ open: false, data: null })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-8">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">거래처명</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900/10" 
                    value={vendorModal.data.name} 
                    onChange={(e) => setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, name: e.target.value } })} 
                  />
                  {vendorModal.data.name && !vendors.find(v => v.name === vendorModal.data.name) && vendors.filter(v => v.name.includes(vendorModal.data.name || '')).length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-100 rounded-xl shadow-xl max-h-32 overflow-y-auto">
                      {vendors.filter(v => v.name.includes(vendorModal.data.name || '')).map(v => (
                        <button 
                          key={v.id}
                          className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 border-b border-slate-50 last:border-0"
                          onClick={() => setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, ...v } })}
                        >
                          {v.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">조직/소속</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900/10" 
                    placeholder="예: 영업본부"
                    value={vendorModal.data.orgChart} 
                    onChange={(e) => setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, orgChart: e.target.value } })} 
                  />
                  {vendorModal.data.orgChart && vendors.filter(v => v.orgChart.includes(vendorModal.data.orgChart || '')).length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-100 rounded-xl shadow-xl max-h-32 overflow-y-auto">
                      {[...new Set(vendors.map(v => v.orgChart))].filter((o: string) => o.includes(vendorModal.data.orgChart || '')).map(o => (
                        <button 
                          key={o}
                          className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 border-b border-slate-50 last:border-0"
                          onClick={() => setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, orgChart: o } })}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Contacts Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                    <Users size={14} className="text-blue-500" /> 담당자 목록
                  </h4>
                  <button 
                    onClick={() => {
                      const contacts = [...(vendorModal.data!.contacts || [])];
                      contacts.push({ name: '', position: '', phones: [''], emails: [''] });
                      setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                    }}
                    className="text-[10px] font-black text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-lg transition-colors border border-blue-100"
                  >
                    + 담당자 추가
                  </button>
                </div>

                <div className="space-y-6">
                  {(vendorModal.data!.contacts || []).map((contact, cIdx) => (
                    <div key={cIdx} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 relative group/contact">
                      <button 
                        onClick={() => {
                          const contacts = (vendorModal.data!.contacts || []).filter((_, i) => i !== cIdx);
                          setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                        }}
                        className="absolute top-4 right-4 text-slate-300 hover:text-red-500 opacity-0 group-hover/contact:opacity-100 transition-opacity"
                      >
                        <Trash2 size={16} />
                      </button>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-[8px] font-black text-slate-400 uppercase mb-1">성명</label>
                          <input 
                            type="text" 
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-900/10" 
                            value={contact.name} 
                            onChange={(e) => {
                              const contacts = [...vendorModal.data!.contacts!];
                              contacts[cIdx].name = e.target.value;
                              setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                            }} 
                          />
                        </div>
                        <div>
                          <label className="block text-[8px] font-black text-slate-400 uppercase mb-1">직급/역할</label>
                          <input 
                            type="text" 
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-900/10" 
                            value={contact.position} 
                            onChange={(e) => {
                              const contacts = [...vendorModal.data!.contacts!];
                              contacts[cIdx].position = e.target.value;
                              setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                            }} 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Phones */}
                        <div className="space-y-2">
                          <label className="block text-[8px] font-black text-slate-400 uppercase">연락처 (전화번호)</label>
                          {(contact.phones || []).map((phone, pIdx) => (
                            <div key={pIdx} className="flex gap-2">
                              <input 
                                type="text" 
                                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-900/10" 
                                value={phone} 
                                onChange={(e) => {
                                  const contacts = [...vendorModal.data!.contacts!];
                                  contacts[cIdx].phones[pIdx] = e.target.value;
                                  setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                                }} 
                              />
                              {pIdx > 0 && (
                                <button onClick={() => {
                                  const contacts = [...vendorModal.data!.contacts!];
                                  contacts[cIdx].phones = contacts[cIdx].phones.filter((_, i) => i !== pIdx);
                                  setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                                }} className="p-2 text-slate-300 hover:text-red-500"><X size={14} /></button>
                              )}
                            </div>
                          ))}
                          <button 
                            onClick={() => {
                              const contacts = [...vendorModal.data!.contacts!];
                              contacts[cIdx].phones.push('');
                              setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                            }}
                            className="text-[9px] font-black text-slate-400 hover:text-slate-600 transition-colors"
                          >+ 전화번호 추가</button>
                        </div>

                        {/* Emails */}
                        <div className="space-y-2">
                          <label className="block text-[8px] font-black text-slate-400 uppercase">이메일</label>
                          {(contact.emails || []).map((email, eIdx) => (
                            <div key={eIdx} className="flex gap-2">
                              <input 
                                type="text" 
                                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-900/10" 
                                value={email} 
                                onChange={(e) => {
                                  const contacts = [...vendorModal.data!.contacts!];
                                  contacts[cIdx].emails[eIdx] = e.target.value;
                                  setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                                }} 
                              />
                              {eIdx > 0 && (
                                <button onClick={() => {
                                  const contacts = [...vendorModal.data!.contacts!];
                                  contacts[cIdx].emails = contacts[cIdx].emails.filter((_, i) => i !== eIdx);
                                  setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                                }} className="p-2 text-slate-300 hover:text-red-500"><X size={14} /></button>
                              )}
                            </div>
                          ))}
                          <button 
                            onClick={() => {
                              const contacts = [...vendorModal.data!.contacts!];
                              contacts[cIdx].emails.push('');
                              setVendorModal({ ...vendorModal, data: { ...vendorModal.data!, contacts } });
                            }}
                            className="text-[9px] font-black text-slate-400 hover:text-slate-600 transition-colors"
                          >+ 이메일 추가</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-50 flex gap-3 shrink-0">
              <button 
                onClick={() => handleVendorAction('save', vendorModal.data!)} 
                className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-black text-sm shadow-xl active:scale-95 transition-transform"
              >데이터 저장하기</button>
              <button onClick={() => setVendorModal({ open: false, data: null })} className="flex-1 bg-white border border-slate-200 py-3 rounded-xl font-black text-sm text-slate-500">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Todo Modal */}
      {todoModal.open && todoModal.data && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-4xl shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800">할 일 관리</h3>
              <button onClick={() => setTodoModal({ open: false, data: null })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">할 일 내용</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={todoModal.data.task} 
                  onChange={(e) => setTodoModal({ ...todoModal, data: { ...todoModal.data!, task: e.target.value } })} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">우선순위</label>
                  <select 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={todoModal.data.priority} 
                    onChange={(e) => setTodoModal({ ...todoModal, data: { ...todoModal.data!, priority: e.target.value as any } })}
                  >
                    <option value="high">높음 (High)</option>
                    <option value="medium">중간 (Medium)</option>
                    <option value="low">낮음 (Low)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">기한</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                    value={todoModal.data.dueDate} 
                    onChange={(e) => setTodoModal({ ...todoModal, data: { ...todoModal.data!, dueDate: e.target.value } })} 
                  />
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button 
                onClick={() => handleTodoAction('save', todoModal.data!)} 
                className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-black text-sm shadow-xl active:scale-95 transition-transform"
              >저장하기</button>
              <button onClick={() => setTodoModal({ open: false, data: null })} className="flex-1 bg-white border border-slate-200 py-3 rounded-xl font-black text-sm text-slate-500">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Vision Modal */}
      {visionModal.open && visionModal.data && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-4xl shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800">목표 설정</h3>
              <button onClick={() => setVisionModal({ open: false, data: null })} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">목표명</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={visionModal.data.title} 
                  onChange={(e) => setVisionModal({ ...visionModal, data: { ...visionModal.data!, title: e.target.value } })} 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">상세 설명</label>
                <textarea 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 min-h-[100px]" 
                  value={visionModal.data.description} 
                  onChange={(e) => setVisionModal({ ...visionModal, data: { ...visionModal.data!, description: e.target.value } })} 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">목표 시점 (YYYY-MM)</label>
                <input 
                  type="month" 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" 
                  value={visionModal.data.date} 
                  onChange={(e) => setVisionModal({ ...visionModal, data: { ...visionModal.data!, date: e.target.value } })} 
                />
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button 
                onClick={() => handleVisionAction('save', visionModal.data!)} 
                className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-black text-sm shadow-xl active:scale-95 transition-transform"
              >저장하기</button>
              <button onClick={() => setVisionModal({ open: false, data: null })} className="flex-1 bg-white border border-slate-200 py-3 rounded-xl font-black text-sm text-slate-500">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Org Chart Visualization Modal */}
      {showOrgChart && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-black text-slate-800">거래처 조직도 시각화</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Visual Organizational Hierarchy</p>
              </div>
              <button onClick={() => setShowOrgChart(false)} className="p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-8 overflow-auto custom-scrollbar flex-1 bg-slate-50/50">
              {/* Simple Tree Structure Rendering */}
              <div className="space-y-8">
                {Object.entries(
                  vendors.reduce((acc, v) => {
                    const org = v.orgChart || '기타 / 미분류';
                    if (!acc[org]) acc[org] = [];
                    acc[org].push(v);
                    return acc;
                  }, {} as Record<string, Vendor[]>)
                ).map(([org, items]: [string, Vendor[]]) => (
                  <div key={org} className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black shadow-md z-10">
                        {org}
                      </div>
                      <div className="h-[2px] flex-1 bg-slate-200"></div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pl-4 border-l-2 border-slate-100 ml-6">
                      {items.map(v => (
                        <div key={v.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-50 text-orange-500 rounded-xl flex items-center justify-center shrink-0">
                            <Building2 size={18} />
                          </div>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-black text-slate-800 truncate">{v.name}</h4>
                            <p className="text-[9px] font-bold text-slate-400 truncate">
                              {v.contacts?.[0]?.name ? `${v.contacts[0].name} ${v.contacts[0].position}` : '담당자 없음'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="p-6 bg-white border-t border-slate-50 flex justify-end shrink-0">
              <button 
                onClick={() => setShowOrgChart(false)} 
                className="px-8 py-3 bg-slate-100 text-slate-500 rounded-xl font-black text-xs hover:bg-slate-200 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
      {processingStatus.active && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[2000] flex items-center justify-center px-4">
          <div className="bg-white p-8 lg:p-10 rounded-[2.5rem] lg:rounded-[3rem] shadow-2xl flex flex-col items-center gap-4 lg:gap-6 w-full max-w-xs lg:max-w-sm animate-in zoom-in-95">
            <div className="relative w-16 h-16 lg:w-20 lg:h-20">
              <div className="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="text-center w-full">
              <h3 className="text-xl lg:text-2xl font-black text-slate-900 mb-1">AI 분석 중...</h3>
              <p className="text-slate-500 text-[10px] lg:text-xs font-bold mb-3 lg:mb-4">명세서 이미지를 데이터로 변환하고 있습니다.</p>
              <div className="text-3xl lg:text-4xl font-black text-blue-600 mb-3 lg:mb-4 font-mono tracking-tighter">
                {processingStatus.current} / {processingStatus.total}
              </div>
              <div className="w-full h-2 lg:h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                <div 
                  className="h-full bg-blue-600 transition-all duration-500 rounded-full" 
                  style={{ width: `${(processingStatus.current / processingStatus.total) * 100}%` }}
                />
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
      {/* Hidden File Input */}
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef} 
        multiple 
        accept="image/*" 
        onChange={handleFileUpload} 
      />
    </div>
  );
}

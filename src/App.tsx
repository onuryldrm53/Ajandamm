declare const __app_id: string | undefined;
declare const __firebase_config: string | undefined;
declare const __initial_auth_token: string | undefined;

import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Download, 
  X, 
  Type, 
  Image as ImageIcon,
  Trash2,
  FileText,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Palette,
  Crop,
  Eraser,
  RotateCcw,
  Check,
  Sliders,
  Shapes,
  Ruler,
  FolderHeart,
  Plus,
  Cloud,
  RefreshCw,
  Copy,
  Undo2,
  Table2,
  Sparkles
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// Bulut senkronizasyonu için başlatma (varsa ortam yapılandırmasını kullanır)
let cloudAuth = null;
let cloudDb = null;
const cloudAppId = typeof __app_id !== 'undefined' ? __app_id : 'agenda-400-notebook';

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    const parsedConfig = JSON.parse(__firebase_config);
    const fbApp = initializeApp(parsedConfig);
    cloudAuth = getAuth(fbApp);
    cloudDb = getFirestore(fbApp);
  }
} catch {
  // Yapılandırma yoksa yerel modda sorunsuz devam et
}

export default function App() {
  const TOTAL_PAGES = 400;

  // Bulut Senkronizasyonu ve Cihaz Eşleştirme Durumları
  const [cloudUser, setCloudUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('local'); // 'local' | 'syncing' | 'synced' | 'error'
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncCodeInput, setSyncCodeInput] = useState('');
  const [activeNotebookKey, setActiveNotebookKey] = useState('');
  const [cloudLoadComplete, setCloudLoadComplete] = useState(false);
  const isApplyingRemoteUpdateRef = useRef(false);
  const cloudSaveTimerRef = useRef(null);

  // Geri Al (Undo) Geçmiş Yığını ve Anlık Durum Referansları
  const [undoCount, setUndoCount] = useState(0);
  const undoStackRef = useRef([]);
  const isRestoringUndoRef = useRef(false);
  const pagesContentRef = useRef({});
  const pageBgColorsRef = useRef({});
  const pageBgImagesRef = useRef({});
  const pageRulingsRef = useRef({});
  const pageDrawingsRef = useRef({});
  const pageItemsRef = useRef<Record<string, any[]>>({});

  // Aktif sol sayfa numarası (0 = Tek Kapak Sayfası, ardından 1-2, 3-4, 5-6... şeklinde tek-çift karşılıklı sayfalar)
  const [currentLeftPage, setCurrentLeftPage] = useState(0);
  const isCoverView = currentLeftPage === 0;
  const currentRightPage = isCoverView ? null : currentLeftPage + 1;

  // Sayfa içerikleri (localStorage destekli)
  const [pagesContent, setPagesContent] = useState(() => {
    try {
      const saved = localStorage.getItem('agenda_400_pages_v3');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Sayfa arkaplan renkleri (localStorage destekli)
  const [pageBgColors, setPageBgColors] = useState(() => {
    try {
      const savedBg = localStorage.getItem('agenda_400_page_bg_v1');
      return savedBg ? JSON.parse(savedBg) : {};
    } catch {
      return {};
    }
  });

  // Sayfa arkaplan resimleri (localStorage destekli)
  const [pageBgImages, setPageBgImages] = useState(() => {
    try {
      const savedBgImgs = localStorage.getItem('agenda_400_page_bg_images_v1');
      return savedBgImgs ? JSON.parse(savedBgImgs) : {};
    } catch {
      return {};
    }
  });

  // Sayfa arkaplan resmi ayarları (pozisyon, ölçek, tekrar vb.)
  const [pageBgImageConfigs, setPageBgImageConfigs] = useState(() => {
    try {
      const saved = localStorage.getItem('agenda_400_page_bg_configs_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Sayfa çizimleri (kalem, fosforlu, silgi katmanı - localStorage destekli)
  const [pageDrawings, setPageDrawings] = useState(() => {
    try {
      const savedDrawings = localStorage.getItem('agenda_400_drawings_v1');
      return savedDrawings ? JSON.parse(savedDrawings) : {};
    } catch {
      return {};
    }
  });

  // Arkaplan Resmi Ayar Penceresi Durumu
  const [bgImageModalPage, setBgImageModalPage] = useState(null);
  const [bgConfigScale, setBgConfigScale] = useState(100);
  const [bgConfigPosX, setBgConfigPosX] = useState(50);
  const [bgConfigPosY, setBgConfigPosY] = useState(50);
  const [bgConfigRepeat, setBgConfigRepeat] = useState('no-repeat');

  // Sayfa çizgi/kare düzeni ('plain' | 'lined' | 'grid' | 'dotted') - Her sayfa için ayrı ayarlanabilir
  const [pageRulings, setPageRulings] = useState(() => {
    try {
      const savedRulings = localStorage.getItem('agenda_400_page_rulings_v1');
      return savedRulings ? JSON.parse(savedRulings) : {};
    } catch {
      return {};
    }
  });

  // Çizim ve Kalem Araçları State Tanımları
  const [penMode, setPenMode] = useState(false);
  const [penTool, setPenTool] = useState('pen'); // 'pen' | 'line' | 'highlighter' | 'eraser'
  const [penColor, setPenColor] = useState('#1e293b');
  const [penSize, setPenSize] = useState(4);
  const isDrawingCanvasRef = useRef(false);
  const activeDrawSideRef = useRef(null);
  const lastDrawPointRef = useRef(null);
  const lineStartPointRef = useRef(null);
  const lineSnapshotRef = useRef(null);
  const leftCanvasRef = useRef(null);
  const rightCanvasRef = useRef(null);

  // Cetvel Aracı State Tanımları
  const [rulerVisible, setRulerVisible] = useState(false);
  const [rulerState, setRulerState] = useState({ x: 220, y: 160, width: 420, angle: 0 });
  const rulerDragRef = useRef(null);

  // Bant (Washi Tape) Çekme Modu State Tanımları
  const [selectedTapeImage, setSelectedTapeImage] = useState(null);
  const [tapeDragPoints, setTapeDragPoints] = useState([]);
  const tapeDragRef = useRef([]);
  const lastTapeStampRef = useRef(null);

  const savePageRuling = (pageNum, rulingType) => {
    setPageRulings((prev) => {
      if (prev[pageNum] !== rulingType) {
        pushUndoSnapshot();
      }
      const updated = { ...prev, [pageNum]: rulingType };
      try {
        localStorage.setItem('agenda_400_page_rulings_v1', JSON.stringify(updated));
      } catch {
        // Yoksay
      }
      return updated;
    });
  };

  // Sayfa Bağımsız Öğeleri: Şekiller, Metin Kutuları ve Görseller (Tam Kontrollü React State - Asla Silinmez, Renk ve Saydamlık %100 Çalışır)
  const [pageItems, setPageItems] = useState(() => {
    try {
      const savedItems = localStorage.getItem('agenda_400_items_v1');
      return savedItems ? JSON.parse(savedItems) : {};
    } catch {
      return {};
    }
  });

  // Referansları güncel state ile senkronize tut
  useEffect(() => { pagesContentRef.current = pagesContent; }, [pagesContent]);
  useEffect(() => { pageBgColorsRef.current = pageBgColors; }, [pageBgColors]);
  useEffect(() => { pageBgImagesRef.current = pageBgImages; }, [pageBgImages]);
  useEffect(() => { pageRulingsRef.current = pageRulings; }, [pageRulings]);
  useEffect(() => { pageDrawingsRef.current = pageDrawings; }, [pageDrawings]);
  useEffect(() => { pageItemsRef.current = pageItems; }, [pageItems]);

  // Mevcut durumun anlık görüntüsünü Geri Al (Undo) geçmişine kaydet
  const pushUndoSnapshot = (overrideSnapshot = null) => {
    if (isRestoringUndoRef.current || isApplyingRemoteUpdateRef.current) return;
    const snapshot = overrideSnapshot || {
      pagesContent: { ...pagesContentRef.current },
      pageBgColors: { ...pageBgColorsRef.current },
      pageBgImages: { ...pageBgImagesRef.current },
      pageRulings: { ...pageRulingsRef.current },
      pageDrawings: { ...pageDrawingsRef.current },
      pageItems: JSON.parse(JSON.stringify(pageItemsRef.current || {}))
    };
    const last = undoStackRef.current[undoStackRef.current.length - 1];
    if (
      last &&
      JSON.stringify(last.pagesContent) === JSON.stringify(snapshot.pagesContent) &&
      JSON.stringify(last.pageItems) === JSON.stringify(snapshot.pageItems) &&
      JSON.stringify(last.pageDrawings) === JSON.stringify(snapshot.pageDrawings) &&
      JSON.stringify(last.pageBgColors) === JSON.stringify(snapshot.pageBgColors) &&
      JSON.stringify(last.pageBgImages) === JSON.stringify(snapshot.pageBgImages) &&
      JSON.stringify(last.pageRulings) === JSON.stringify(snapshot.pageRulings)
    ) {
      return;
    }
    undoStackRef.current = [...undoStackRef.current.slice(-39), snapshot];
    setUndoCount(undoStackRef.current.length);
  };

  // Son yapılan hamleyi bir önceki haline geri döndür
  const handleUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const prevSnapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoCount(undoStackRef.current.length);

    isRestoringUndoRef.current = true;
    try {
      setPagesContent(prevSnapshot.pagesContent);
      setPageBgColors(prevSnapshot.pageBgColors);
      setPageBgImages(prevSnapshot.pageBgImages);
      setPageRulings(prevSnapshot.pageRulings);
      setPageDrawings(prevSnapshot.pageDrawings);
      if (prevSnapshot.pageItems) {
        setPageItems(prevSnapshot.pageItems);
      }

      try {
        localStorage.setItem('agenda_400_pages_v3', JSON.stringify(prevSnapshot.pagesContent));
        localStorage.setItem('agenda_400_page_bg_v1', JSON.stringify(prevSnapshot.pageBgColors));
        localStorage.setItem('agenda_400_page_bg_images_v1', JSON.stringify(prevSnapshot.pageBgImages));
        localStorage.setItem('agenda_400_page_rulings_v1', JSON.stringify(prevSnapshot.pageRulings));
        localStorage.setItem('agenda_400_drawings_v1', JSON.stringify(prevSnapshot.pageDrawings));
        if (prevSnapshot.pageItems) {
          localStorage.setItem('agenda_400_items_v1', JSON.stringify(prevSnapshot.pageItems));
        }
      } catch {
        // Depolama sınırı aşılırsa yoksay
      }

      if (leftEditorRef.current) {
        leftEditorRef.current.innerHTML = prevSnapshot.pagesContent[currentLeftPage] || '';
      }
      if (!isCoverView && rightEditorRef.current) {
        rightEditorRef.current.innerHTML = prevSnapshot.pagesContent[currentRightPage] || '';
      }
      setActiveTextBoxId(null);
      activeTextBoxElementRef.current = null;
    } finally {
      setTimeout(() => {
        isRestoringUndoRef.current = false;
      }, 60);
    }
  };

  // Kayıtlı Görseller Galerisi
  const [savedImages, setSavedImages] = useState(() => {
    try {
      const savedImgs = localStorage.getItem('agenda_400_saved_images_v1');
      return savedImgs ? JSON.parse(savedImgs) : [];
    } catch {
      return [];
    }
  });
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryToast, setGalleryToast] = useState(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [tableGridHover, setTableGridHover] = useState({ rows: 3, cols: 3 });
  const [pageBgPaletteOpen, setPageBgPaletteOpen] = useState(false);

  // Bildirim toast mesajı gösterme yardımcısı
  const showGalleryToast = (msg) => {
    setGalleryToast(msg);
    setTimeout(() => {
      setGalleryToast((current) => (current === msg ? null : current));
    }, 2800);
  };

  const saveImageToGallery = (dataUrl, label = 'Görsel', customDimensions = null) => {
    if (!dataUrl) return;
    const probeImg = new Image();
    probeImg.onload = () => {
      const natW = probeImg.naturalWidth || 160;
      const natH = probeImg.naturalHeight || 160;
      const width = customDimensions?.width ? Math.round(customDimensions.width) : Math.min(220, natW);
      const height = customDimensions?.height ? Math.round(customDimensions.height) : Math.round((width * natH) / Math.max(1, natW));

      const newEntry = {
        id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        src: dataUrl,
        label,
        width,
        height
      };
      setSavedImages((prev) => {
        const next = [newEntry, ...prev].slice(0, 48);
        try {
          localStorage.setItem('agenda_400_saved_images_v1', JSON.stringify(next));
        } catch {
          // Yoksay
        }
        return next;
      });
      showGalleryToast(`"${label}" galerige kaydedildi`);
    };
    probeImg.src = dataUrl;
  };

  const removeImageFromGallery = (id) => {
    setSavedImages((prev) => {
      const next = prev.filter((item) => item.id !== id);
      try {
        localStorage.setItem('agenda_400_saved_images_v1', JSON.stringify(next));
      } catch {
        // Yoksay
      }
      return next;
    });
    showGalleryToast('Görsel galeriden kaldırıldı');
  };

  // Masaüstü Serbest Görseller / Çıkartmalar (localStorage destekli)
  const [deskItems, setDeskItems] = useState(() => {
    try {
      const saved = localStorage.getItem('agenda_400_desk_items_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedDeskItemId, setSelectedDeskItemId] = useState(null);
  const deskItemDragRef = useRef(null);

  // Masa üstü öğelerini yerel depolamaya kaydet
  const updateDeskItems = (updater) => {
    setDeskItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('agenda_400_desk_items_v1', JSON.stringify(next));
      } catch {
        // Depolama sınırı aşılırsa yoksay
      }
      return next;
    });
  };

  // Masaya görsel / çıkartma yerleştirme
  const placeImageOnDesk = (imageSrc, customDimensions = null) => {
    if (!imageSrc) return;
    const id = 'desk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const width = customDimensions?.width ? Math.round(customDimensions.width) : 140;
    const height = customDimensions?.height ? Math.round(customDimensions.height) : 140;
    const newItem = {
      id,
      type: 'image',
      src: imageSrc,
      x: 48 + ((deskItems.length * 24) % 140),
      y: 96 + ((deskItems.length * 28) % 240),
      width,
      height,
      angle: 0
    };
    updateDeskItems((prev) => [...prev, newItem]);
    setSelectedDeskItemId(id);
    showGalleryToast('Görsel masanın üzerine koyuldu');
  };

  // Üst ve Alt Kontrol Panellerinin Görünürlüğü
  const [panelsVisible, setPanelsVisible] = useState(true);

  // Yan Sayfa Yönetimi Çekmecesi
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Hangi sayfanın en son odaklandığı ('left' veya 'right')
  const [activeEditorTarget, setActiveEditorTarget] = useState('left');

  // Editör DOM referansları
  const leftEditorRef = useRef(null);
  const rightEditorRef = useRef(null);
  const fileInputRef = useRef(null);
  const bgImageInputRef = useRef(null);

  // Sürükleme ve Boyutlandırma için Referans
  const interactionStateRef = useRef(null);

  // PowerPoint Tarzı Akıllı Hizalama Kılavuz Çizgileri (Smart Alignment Guides)
  const [alignmentGuides, setAlignmentGuides] = useState({
    vertical: [],
    horizontal: [],
    spacing: []
  });

  // Resim Düzenleme (Kırpma & Arkaplan Kaldırma) Modal Durumu
  const [editingImageModal, setEditingImageModal] = useState(null);
  const [cropRect, setCropRect] = useState({ x: 5, y: 5, width: 90, height: 90 });
  const [cropAspect, setCropAspect] = useState('free');
  const [bgRemoveTolerance, setBgRemoveTolerance] = useState(32);
  const [bgRemovedPreviewSrc, setBgRemovedPreviewSrc] = useState(null);
  const [isProcessingBg, setIsProcessingBg] = useState(false);
  const [manualBrushMode, setManualBrushMode] = useState(null); // null | 'erase' | 'restore'
  const [brushSize, setBrushSize] = useState(24);
  const [brushCursorPos, setBrushCursorPos] = useState(null);
  const isBrushingRef = useRef(false);
  const lastBrushPointRef = useRef(null);
  const brushCanvasRef = useRef(null);
  const originalImgObjRef = useRef(null);
  const cropDragRef = useRef(null);
  const cropContainerRef = useRef(null);

  // Aktif Metin Kutusu Biçimlendirme Araç Çubuğu Durumu
  const [activeTextBoxId, setActiveTextBoxId] = useState(null);
  const [activeTableCell, setActiveTableCell] = useState(null); // { boxId, row, col }
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [selectedImageOpacity, setSelectedImageOpacity] = useState(null);
  const selectedImageElementRef = useRef(null);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const [bgPaletteOpen, setBgPaletteOpen] = useState(false);
  const [currentHeadingStyle, setCurrentHeadingStyle] = useState('p');
  const [currentFontFamily, setCurrentFontFamily] = useState("'Inter', sans-serif");
  const [currentFontSize, setCurrentFontSize] = useState('15px');
  const [currentTextColor, setCurrentTextColor] = useState('#1e293b');
  const [currentHighlightColor, setCurrentHighlightColor] = useState('transparent');
  const [currentBoxBgColor, setCurrentBoxBgColor] = useState('transparent');
  const [currentBoxShape, setCurrentBoxShape] = useState('default');
  const [currentBoxOpacity, setCurrentBoxOpacity] = useState(100);
  const [currentLineHeight, setCurrentLineHeight] = useState('1.5');
  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    subscript: false,
    superscript: false,
    insertUnorderedList: false,
    insertOrderedList: false,
    justifyLeft: true,
    justifyCenter: false,
    justifyRight: false,
    justifyFull: false
  });
  const activeTextBoxElementRef = useRef(null);
  const savedSelectionRef = useRef(null);

  // 3D Sayfa Kıvrılma / Çevirme Durumu
  const [pageTurn, setPageTurn] = useState(null);
  const curlDragRef = useRef(null);
  const turnAnimFrameRef = useRef(null);
  const currentTurnProgressRef = useRef(0);

  // Bulut kimlik doğrulama ve kullanıcı defter anahtarını başlatma
  useEffect(() => {
    if (!cloudAuth) return;
    const initCloudAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(cloudAuth, __initial_auth_token);
        } else {
          await signInAnonymously(cloudAuth);
        }
      } catch {
        setSyncStatus('error');
      }
    };
    initCloudAuth();
    const unsub = onAuthStateChanged(cloudAuth, (u) => {
      setCloudUser(u || null);
      if (u) {
        setActiveNotebookKey((prev) => prev || u.uid);
      }
    });
    return () => unsub();
  }, []);

  // Bulut verisini gerçek zamanlı dinleme (Farklı cihazlardan anlık senkronizasyon)
  useEffect(() => {
    if (!cloudDb || !cloudUser || !activeNotebookKey) return;
    setCloudLoadComplete(false);
    setSyncStatus('syncing');
    const notebookRef = doc(cloudDb, 'artifacts', cloudAppId, 'public', 'data', 'notebooks', activeNotebookKey);
    const unsub = onSnapshot(
      notebookRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() || {};
          isApplyingRemoteUpdateRef.current = true;
          try {
            if (data.pagesContent) {
              const parsedPages = typeof data.pagesContent === 'string' ? JSON.parse(data.pagesContent) : data.pagesContent;
              setPagesContent(parsedPages);
              if (!interactionStateRef.current) {
                if (leftEditorRef.current && parsedPages[currentLeftPage] !== undefined) {
                  leftEditorRef.current.innerHTML = parsedPages[currentLeftPage] || '';
                }
                if (!isCoverView && rightEditorRef.current && parsedPages[currentRightPage] !== undefined) {
                  rightEditorRef.current.innerHTML = parsedPages[currentRightPage] || '';
                }
              }
            }
            if (data.pageBgColors) {
              setPageBgColors(typeof data.pageBgColors === 'string' ? JSON.parse(data.pageBgColors) : data.pageBgColors);
            }
            if (data.pageBgImages) {
              setPageBgImages(typeof data.pageBgImages === 'string' ? JSON.parse(data.pageBgImages) : data.pageBgImages);
            }
            if (data.pageBgImageConfigs) {
              setPageBgImageConfigs(typeof data.pageBgImageConfigs === 'string' ? JSON.parse(data.pageBgImageConfigs) : data.pageBgImageConfigs);
            }
            if (data.pageRulings) {
              setPageRulings(typeof data.pageRulings === 'string' ? JSON.parse(data.pageRulings) : data.pageRulings);
            }
            if (data.pageDrawings) {
              setPageDrawings(typeof data.pageDrawings === 'string' ? JSON.parse(data.pageDrawings) : data.pageDrawings);
            }
            if (data.pageItems) {
              setPageItems(typeof data.pageItems === 'string' ? JSON.parse(data.pageItems) : data.pageItems);
            }
            if (data.savedImages) {
              setSavedImages(typeof data.savedImages === 'string' ? JSON.parse(data.savedImages) : data.savedImages);
            }
          } finally {
            setTimeout(() => {
              isApplyingRemoteUpdateRef.current = false;
              setCloudLoadComplete(true);
            }, 120);
          }
        }
        if (!snap.exists()) setCloudLoadComplete(true);
        setSyncStatus('synced');
      },
      () => {
        setSyncStatus('error');
      }
    );
    return () => unsub();
  }, [cloudUser, activeNotebookKey]);

  // Yapılan değişiklikleri buluta otomatik senkronize etme (Debounce)
  useEffect(() => {
    if (!cloudDb || !cloudUser || !activeNotebookKey || !cloudLoadComplete || isApplyingRemoteUpdateRef.current) return;
    setSyncStatus('syncing');
    if (cloudSaveTimerRef.current) {
      clearTimeout(cloudSaveTimerRef.current);
    }
    cloudSaveTimerRef.current = setTimeout(async () => {
      try {
        const notebookRef = doc(cloudDb, 'artifacts', cloudAppId, 'public', 'data', 'notebooks', activeNotebookKey);
        await setDoc(
          notebookRef,
          {
            pagesContent: JSON.stringify(pagesContent),
            pageBgColors: JSON.stringify(pageBgColors),
            pageBgImages: JSON.stringify(pageBgImages),
            pageBgImageConfigs: JSON.stringify(pageBgImageConfigs),
            pageRulings: JSON.stringify(pageRulings),
            pageDrawings: JSON.stringify(pageDrawings),
            pageItems: JSON.stringify(pageItems),
            savedImages: JSON.stringify(savedImages),
            updatedAt: Date.now()
          },
          { merge: true }
        );
        setSyncStatus('synced');
      } catch {
        setSyncStatus('error');
      }
    }, 900);

    return () => {
      if (cloudSaveTimerRef.current) {
        clearTimeout(cloudSaveTimerRef.current);
      }
    };
  }, [pagesContent, pageBgColors, pageBgImages, pageBgImageConfigs, pageRulings, pageDrawings, pageItems, savedImages, cloudUser, activeNotebookKey, cloudLoadComplete]);

  // Sayfa Bağımsız Öğelerini (Şekil, Metin Kutusu, Tablo, Görsel, Bant) Kaydetme ve Güncelleme Yardımcıları
  const persistPageItems = (updater, recordUndo = false) => {
    setPageItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (recordUndo && JSON.stringify(prev) !== JSON.stringify(next)) {
        pushUndoSnapshot();
      }
      try {
        localStorage.setItem('agenda_400_items_v1', JSON.stringify(next));
      } catch {
        // Depolama sınırı aşılırsa yoksay
      }
      return next;
    });
  };

  const updateItemOnPage = (pageNum, itemId, patch, recordUndo = false) => {
    persistPageItems((prev) => {
      const list = prev[pageNum] || [];
      const updatedList = list.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
      return { ...prev, [pageNum]: updatedList };
    }, recordUndo);
  };

  const removeItemFromPage = (pageNum, itemId) => {
    persistPageItems((prev) => {
      const list = (prev[pageNum] || []).filter((it) => it.id !== itemId);
      return { ...prev, [pageNum]: list };
    }, true);
    if (activeTextBoxId === itemId) {
      setActiveTextBoxId(null);
      activeTextBoxElementRef.current = null;
    }
  };

  // Öğeyi Çoğaltma (Duplicate) ve Sabitleme / Kilitleme (Lock) Yardımcıları
  const duplicateItemOnPage = (pageNum, item) => {
    if (!item) return;
    const prefix = item.itemType === 'image' ? 'img_' : item.itemType === 'tape' ? 'tape_' : 'tb_';
    const newId = prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const clonedItem = JSON.parse(JSON.stringify(item));
    clonedItem.id = newId;
    clonedItem.x = (item.x || 0) + 24;
    clonedItem.y = (item.y || 0) + 24;
    clonedItem.locked = false;

    persistPageItems((prev) => ({
      ...prev,
      [pageNum]: [...(prev[pageNum] || []), clonedItem]
    }), true);

    if (item.itemType === 'image' || item.itemType === 'tape') {
      selectedImageElementRef.current = { itemId: newId, pageNum };
      setSelectedImageId(newId);
      setSelectedImageOpacity(clonedItem.opacity ?? 100);
    } else {
      setActiveTextBoxId(newId);
      setActiveTableCell(null);
    }
    showGalleryToast('Öğe çoğaltıldı');
  };

  const toggleLockItemOnPage = (pageNum, item) => {
    if (!item) return;
    const nextLocked = !item.locked;
    updateItemOnPage(pageNum, item.id, { locked: nextLocked }, true);
    showGalleryToast(nextLocked ? 'Öğe sabitlendi (kilitlendi)' : 'Öğe kilidi açıldı');
  };

  // Öğelerin (Şekil, Metin Kutusu, Tablo, Resim, Bant) Katman Sırasını (Öne Al / Arkaya Al) Değiştirme
  const changeLayerOrder = (direction, targetEl = null, targetItemId = null, targetPage = null) => {
    const bookEl = document.getElementById('agenda-book');
    if (!bookEl) return;

    const allEls = Array.from(bookEl.querySelectorAll<HTMLElement>('.agenda-block-wrapper'));
    const zValues = allEls.map((el) => {
      const z = parseInt(el.style.zIndex || '32', 10);
      return isNaN(z) ? 32 : z;
    });
    const currentMaxZ = zValues.length > 0 ? Math.max(...zValues) : 34;
    const currentMinZ = zValues.length > 0 ? Math.min(...zValues) : 32;

    const nextZ = direction === 'front' ? currentMaxZ + 1 : Math.max(10, currentMinZ - 1);

    if (targetItemId && targetPage !== null) {
      updateItemOnPage(targetPage, targetItemId, { zIndex: nextZ }, true);
      return;
    }

    const el =
      targetEl ||
      selectedImageElementRef.current ||
      activeTextBoxElementRef.current ||
      document.querySelector('.agenda-block-wrapper.is-selected');

    if (el) {
      el.style.zIndex = String(nextZ);
      el.setAttribute('data-z-index', String(nextZ));
      if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
      if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
    }
  };

  // İçeriği kaydetme fonksiyonu
  const saveContent = (pageNum, htmlContent) => {
    setPagesContent((prev) => {
      if ((prev[pageNum] || '') !== (htmlContent || '')) {
        pushUndoSnapshot();
      }
      const updated = { ...prev, [pageNum]: htmlContent };
      try {
        localStorage.setItem('agenda_400_pages_v3', JSON.stringify(updated));
      } catch (e) {
        // Depolama sınırı aşılırsa yoksay
      }
      return updated;
    });
  };

  // Seçili sayfanın arkaplan rengini kaydetme fonksiyonu
  const savePageBgColor = (pageNum, color) => {
    setPageBgColors((prev) => {
      if (prev[pageNum] !== color) {
        pushUndoSnapshot();
      }
      const updated = { ...prev, [pageNum]: color };
      try {
        localStorage.setItem('agenda_400_page_bg_v1', JSON.stringify(updated));
      } catch (e) {
        // Depolama sınırı aşılırsa yoksay
      }
      return updated;
    });
  };

  // Seçili sayfanın arkaplan resmini kaydetme / kaldırma fonksiyonu
  const savePageBgImage = (pageNum, imageDataUrl, customConfig = null) => {
    setPageBgImages((prev) => {
      if ((prev[pageNum] || null) !== (imageDataUrl || null)) {
        pushUndoSnapshot();
      }
      const updated = { ...prev };
      if (imageDataUrl) {
        updated[pageNum] = imageDataUrl;
      } else {
        delete updated[pageNum];
      }
      try {
        localStorage.setItem('agenda_400_page_bg_images_v1', JSON.stringify(updated));
      } catch (e) {
        // Depolama sınırı aşılırsa yoksay
      }
      return updated;
    });

    if (customConfig) {
      setPageBgImageConfigs((prev) => {
        const updated = { ...prev, [pageNum]: customConfig };
        try {
          localStorage.setItem('agenda_400_page_bg_configs_v1', JSON.stringify(updated));
        } catch (e) {
          // Yoksay
        }
        return updated;
      });
    } else if (!imageDataUrl) {
      setPageBgImageConfigs((prev) => {
        const updated = { ...prev };
        delete updated[pageNum];
        try {
          localStorage.setItem('agenda_400_page_bg_configs_v1', JSON.stringify(updated));
        } catch (e) {
          // Yoksay
        }
        return updated;
      });
    }
  };

  // Seçili sayfaya arkaplan resmi yükleme işleyicisi
  const handlePageBgImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetPage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (result) {
        const defaultCfg = { scale: 100, posX: 50, posY: 50, repeat: 'no-repeat' };
        savePageBgImage(targetPage, result, defaultCfg);
        setBgImageModalPage(targetPage);
        setBgConfigScale(100);
        setBgConfigPosX(50);
        setBgConfigPosY(50);
        setBgConfigRepeat('no-repeat');
        setPageBgPaletteOpen(false);
        showGalleryToast(isCoverView ? 'Kapak arkaplan resmi eklendi (Ayarlayabilirsiniz)' : `Sayfa ${targetPage} arkaplan resmi eklendi (Ayarlayabilirsiniz)`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Sayfa değiştiğinde DOM editörlerine içeriği aktarma
  useEffect(() => {
    setActiveTextBoxId(null);
    setActiveTableCell(null);
    setSelectedImageId(null);
    setSelectedImageOpacity(null);
    selectedImageElementRef.current = null;
    setFontMenuOpen(false);
    setColorPaletteOpen(false);
    setBgPaletteOpen(false);
    activeTextBoxElementRef.current = null;
    if (isCoverView) {
      setActiveEditorTarget('left');
    }
    if (leftEditorRef.current) {
      leftEditorRef.current.innerHTML = pagesContent[currentLeftPage] || '';
    }
    if (!isCoverView && rightEditorRef.current) {
      rightEditorRef.current.innerHTML = pagesContent[currentRightPage] || '';
    }
  }, [currentLeftPage]);

  // Sayfa değiştiğinde veya yeniden boyutlandığında çizim katmanlarını (Canvas) yükle
  const renderDrawingToCanvas = (canvasEl, pageNum) => {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round(rect.height * dpr));
    if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
      canvasEl.width = targetW;
      canvasEl.height = targetH;
    }
    const ctx = canvasEl.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    const dataUrl = pageDrawings[pageNum];
    if (dataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
      };
      img.src = dataUrl;
    }
  };

  useEffect(() => {
    renderDrawingToCanvas(leftCanvasRef.current, currentLeftPage);
    if (!isCoverView) {
      renderDrawingToCanvas(rightCanvasRef.current, currentRightPage);
    }
  }, [currentLeftPage, currentRightPage, isCoverView, pageDrawings]);

  useEffect(() => {
    const handleResizeCanvases = () => {
      renderDrawingToCanvas(leftCanvasRef.current, currentLeftPage);
      if (!isCoverView) {
        renderDrawingToCanvas(rightCanvasRef.current, currentRightPage);
      }
    };
    window.addEventListener('resize', handleResizeCanvases);
    return () => window.removeEventListener('resize', handleResizeCanvases);
  }, [currentLeftPage, currentRightPage, isCoverView, pageDrawings]);

  // Kalem Çizim Yardımcıları
  const saveCanvasDrawing = (canvasEl, pageNum) => {
    if (!canvasEl) return;
    const dataUrl = canvasEl.toDataURL('image/png');
    setPageDrawings((prev) => {
      if (prev[pageNum] !== dataUrl) {
        pushUndoSnapshot();
      }
      const updated = { ...prev, [pageNum]: dataUrl };
      try {
        localStorage.setItem('agenda_400_drawings_v1', JSON.stringify(updated));
      } catch {
        // Depolama sınırı aşılırsa yoksay
      }
      return updated;
    });
  };

  const clearPageDrawing = (pageNum) => {
    const canvasEl = pageNum === currentLeftPage ? leftCanvasRef.current : rightCanvasRef.current;
    if (canvasEl) {
      const ctx = canvasEl.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    setPageDrawings((prev) => {
      if (prev[pageNum]) {
        pushUndoSnapshot();
      }
      const updated = { ...prev };
      delete updated[pageNum];
      try {
        localStorage.setItem('agenda_400_drawings_v1', JSON.stringify(updated));
      } catch {
        // Yoksay
      }
      return updated;
    });
  };

  const getCanvasPoint = (e, canvasEl) => {
    const rect = canvasEl.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvasEl.width / Math.max(1, rect.width);
    const scaleY = canvasEl.height / Math.max(1, rect.height);

    let screenX = clientX;
    let screenY = clientY;

    // Cetvel açıksa ve kalem cetvelin üst/alt kenarına yakınsa çizgiyi cetvel kenarına mıknatısla
    if (rulerVisible && penTool !== 'eraser') {
      const rulerEl = document.getElementById('agenda-ruler');
      if (rulerEl) {
        const rRect = rulerEl.getBoundingClientRect();
        const cx = rRect.left + rRect.width / 2;
        const cy = rRect.top + rRect.height / 2;
        const w = rulerEl.offsetWidth;
        const h = rulerEl.offsetHeight;
        const rad = (rulerState.angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Fare koordinatını cetvelin yerel koordinat sistemine dönüştür
        const dx = clientX - cx;
        const dy = clientY - cy;
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;

        const snapDist = 18;
        if (localX >= -w / 2 - 12 && localX <= w / 2 + 12) {
          let snappedLocalY = null;
          if (Math.abs(localY - (-h / 2)) <= snapDist) {
            snappedLocalY = -h / 2;
          } else if (Math.abs(localY - h / 2) <= snapDist) {
            snappedLocalY = h / 2;
          }
          if (snappedLocalY !== null) {
            const clampedLocalX = Math.max(-w / 2, Math.min(w / 2, localX));
            screenX = cx + clampedLocalX * cos - snappedLocalY * sin;
            screenY = cy + clampedLocalX * sin + snappedLocalY * cos;
          }
        }
      }
    }

    return {
      x: (screenX - rect.left) * scaleX,
      y: (screenY - rect.top) * scaleY,
      scale: scaleX
    };
  };

  // Cetvelin kenarından tek tıkla doğrudan düz çizgi çizme yardımcısı
  const drawLineAlongRuler = () => {
    const rulerEl = document.getElementById('agenda-ruler');
    if (!rulerEl) return;

    const rRect = rulerEl.getBoundingClientRect();
    const cx = rRect.left + rRect.width / 2;
    const cy = rRect.top + rRect.height / 2;
    const halfW = rulerEl.offsetWidth / 2;
    const topOffset = -rulerEl.offsetHeight / 2;
    const rad = (rulerState.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const p1Screen = {
      x: cx + (-halfW) * cos - topOffset * sin,
      y: cy + (-halfW) * sin + topOffset * cos
    };
    const p2Screen = {
      x: cx + halfW * cos - topOffset * sin,
      y: cy + halfW * sin + topOffset * cos
    };

    const targets = [
      { canvas: leftCanvasRef.current, pageNum: currentLeftPage },
      ...(!isCoverView ? [{ canvas: rightCanvasRef.current, pageNum: currentRightPage }] : [])
    ];

    targets.forEach(({ canvas, pageNum }) => {
      if (!canvas) return;
      const cRect = canvas.getBoundingClientRect();
      const minX = Math.min(p1Screen.x, p2Screen.x);
      const maxX = Math.max(p1Screen.x, p2Screen.x);
      const minY = Math.min(p1Screen.y, p2Screen.y);
      const maxY = Math.max(p1Screen.y, p2Screen.y);

      if (maxX < cRect.left || minX > cRect.right || maxY < cRect.top || minY > cRect.bottom) {
        return;
      }

      const scaleX = canvas.width / Math.max(1, cRect.width);
      const scaleY = canvas.height / Math.max(1, cRect.height);
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize * scaleX;
      ctx.beginPath();
      ctx.moveTo((p1Screen.x - cRect.left) * scaleX, (p1Screen.y - cRect.top) * scaleY);
      ctx.lineTo((p2Screen.x - cRect.left) * scaleX, (p2Screen.y - cRect.top) * scaleY);
      ctx.stroke();
      ctx.restore();
      saveCanvasDrawing(canvas, pageNum);
    });
  };

  // Tuval Üzerinde Serbest Çizim, Düz Çizgi, Fosforlu Kalem ve Silgi İşleyicileri
  const handleCanvasDrawStart = (e, side) => {
    if (!penMode) return;
    e.preventDefault();
    e.stopPropagation();

    const canvasEl = side === 'left' ? leftCanvasRef.current : rightCanvasRef.current;
    if (!canvasEl) return;

    const pt = getCanvasPoint(e, canvasEl);
    isDrawingCanvasRef.current = true;
    activeDrawSideRef.current = side;
    lastDrawPointRef.current = pt;

    const ctx = canvasEl.getContext('2d');
    if (penTool === 'line') {
      lineStartPointRef.current = pt;
      lineSnapshotRef.current = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    } else {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (penTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = penSize * 3.5 * pt.scale;
      } else if (penTool === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = penColor;
        ctx.lineWidth = Math.max(12, penSize * 3.2) * pt.scale;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penSize * pt.scale;
      }
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x + 0.1, pt.y + 0.1);
      ctx.stroke();
      ctx.restore();
    }
  };

  const handleCanvasDrawMove = (e, side) => {
    if (!penMode || !isDrawingCanvasRef.current || activeDrawSideRef.current !== side) return;
    if (e.cancelable && e.touches) e.preventDefault();
    e.stopPropagation();

    const canvasEl = side === 'left' ? leftCanvasRef.current : rightCanvasRef.current;
    if (!canvasEl) return;

    const pt = getCanvasPoint(e, canvasEl);
    const ctx = canvasEl.getContext('2d');

    if (penTool === 'line' && lineStartPointRef.current && lineSnapshotRef.current) {
      ctx.putImageData(lineSnapshotRef.current, 0, 0);
      let endX = pt.x;
      let endY = pt.y;
      if (e.shiftKey) {
        const dx = endX - lineStartPointRef.current.x;
        const dy = endY - lineStartPointRef.current.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        endX = lineStartPointRef.current.x + Math.cos(angle) * dist;
        endY = lineStartPointRef.current.y + Math.sin(angle) * dist;
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize * pt.scale;
      ctx.beginPath();
      ctx.moveTo(lineStartPointRef.current.x, lineStartPointRef.current.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.restore();
      lastDrawPointRef.current = { x: endX, y: endY, scale: pt.scale };
      return;
    }

    const prev = lastDrawPointRef.current || pt;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (penTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = penSize * 3.5 * pt.scale;
    } else if (penTool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = Math.max(12, penSize * 3.2) * pt.scale;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize * pt.scale;
    }
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.restore();
    lastDrawPointRef.current = pt;
  };

  const handleCanvasDrawEnd = () => {
    if (!isDrawingCanvasRef.current) return;
    const side = activeDrawSideRef.current;
    isDrawingCanvasRef.current = false;
    activeDrawSideRef.current = null;
    lastDrawPointRef.current = null;
    lineStartPointRef.current = null;
    lineSnapshotRef.current = null;

    if (side === 'left' && leftCanvasRef.current) {
      saveCanvasDrawing(leftCanvasRef.current, currentLeftPage);
    } else if (side === 'right' && !isCoverView && rightCanvasRef.current) {
      saveCanvasDrawing(rightCanvasRef.current, currentRightPage);
    }
  };

  // Sayfa Çevirme Animasyonu ve Geçiş Yardımcıları
  const commitPageTurn = (direction) => {
    if (direction === 'next') {
      setCurrentLeftPage((prev) => {
        if (prev === 0) return 1;
        if (prev + 2 <= TOTAL_PAGES) return prev + 2;
        return prev;
      });
    } else if (direction === 'prev') {
      setCurrentLeftPage((prev) => {
        if (prev <= 1) return 0;
        return Math.max(1, prev - 2);
      });
    }
  };

  const animateTurnTo = (direction, fromProgress, toProgress, onComplete) => {
    if (turnAnimFrameRef.current) {
      cancelAnimationFrame(turnAnimFrameRef.current);
    }
    const startTime = performance.now();
    const duration = Math.max(160, Math.abs(toProgress - fromProgress) * 420);

    const step = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = fromProgress + (toProgress - fromProgress) * eased;
      currentTurnProgressRef.current = current;

      if (t < 1) {
        setPageTurn({ direction, progress: current, curlTilt: 0 });
        turnAnimFrameRef.current = requestAnimationFrame(step);
      } else {
        setPageTurn(null);
        currentTurnProgressRef.current = 0;
        if (onComplete) onComplete();
      }
    };

    turnAnimFrameRef.current = requestAnimationFrame(step);
  };

  const triggerAnimatedTurn = (direction) => {
    if (direction === 'next' && !isCoverView && currentRightPage >= TOTAL_PAGES) return;
    if (direction === 'prev' && currentLeftPage <= 0) return;
    animateTurnTo(direction, 0.04, 1, () => {
      commitPageTurn(direction);
    });
  };

  const goToPagePair = (pageNum) => {
    if (pageNum <= 0) {
      setCurrentLeftPage(0);
    } else {
      const normalizedLeft = pageNum % 2 === 1 ? pageNum : pageNum - 1;
      setCurrentLeftPage(Math.max(1, Math.min(TOTAL_PAGES - 1, normalizedLeft)));
    }
  };

  const saveActiveTextBoxContent = () => {
    if (leftEditorRef.current) {
      saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
    }
    if (!isCoverView && rightEditorRef.current) {
      saveContent(currentRightPage, rightEditorRef.current.innerHTML);
    }
  };

  const syncToolbarStates = () => {
    try {
      setActiveStyles({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        subscript: document.queryCommandState('subscript'),
        superscript: document.queryCommandState('superscript'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
        justifyLeft: document.queryCommandState('justifyLeft'),
        justifyCenter: document.queryCommandState('justifyCenter'),
        justifyRight: document.queryCommandState('justifyRight'),
        justifyFull: document.queryCommandState('justifyFull')
      });
    } catch {
      // Seçim yoksa yoksay
    }
  };

  const handleToolbarToggle = (e, command) => {
    e.preventDefault();
    const boxEl = activeTextBoxElementRef.current;
    const contentEl = boxEl?.querySelector('.agenda-textbox-content');
    if (contentEl && document.activeElement !== contentEl) {
      contentEl.focus();
    }
    document.execCommand(command, false, null);
    syncToolbarStates();
    saveActiveTextBoxContent();
  };

  const applyTextFormat = (type, value) => {
    // Önce React kontrollü şekil/metin kutusu öğelerinde ara
    let foundPage = null;
    let foundItem = null;
    if (activeTextBoxId) {
      for (const [pKey, list] of Object.entries(pageItemsRef.current || {})) {
        const hit = ((list || []) as any[]).find((it) => it.id === activeTextBoxId);
        if (hit) {
          foundPage = Number(pKey);
          foundItem = hit;
          break;
        }
      }
    }

    const boxEl = activeTextBoxElementRef.current || (activeTextBoxId ? document.getElementById(activeTextBoxId) : null);
    const contentEl = boxEl?.querySelector('.agenda-textbox-content');

    if (foundItem && foundPage !== null) {
      if (type === 'boxBgColor') {
        if (
          foundItem.itemType === 'table' &&
          activeTableCell &&
          activeTableCell.boxId === foundItem.id
        ) {
          const { row, col } = activeTableCell;
          const nextCellColors = { ...(foundItem.cellColors || {}) };
          const key = `${row}_${col}`;
          if (!value || value === 'transparent') {
            delete nextCellColors[key];
          } else {
            nextCellColors[key] = value;
          }
          setCurrentBoxBgColor(value);
          updateItemOnPage(foundPage, foundItem.id, { cellColors: nextCellColors }, true);
          return;
        }
        setCurrentBoxBgColor(value);
        updateItemOnPage(foundPage, foundItem.id, { bgColor: value }, true);
      } else if (type === 'boxOpacity') {
        const numVal = Number(value);
        setCurrentBoxOpacity(numVal);
        updateItemOnPage(foundPage, foundItem.id, { opacity: numVal }, false);
      } else if (type === 'boxShape') {
        setCurrentBoxShape(value);
        updateItemOnPage(foundPage, foundItem.id, { shape: value }, true);
      } else if (type === 'fontFamily') {
        setCurrentFontFamily(value);
        updateItemOnPage(foundPage, foundItem.id, { fontFamily: value }, true);
      } else if (type === 'fontSizePx') {
        setCurrentFontSize(value);
        updateItemOnPage(foundPage, foundItem.id, { fontSize: value }, true);
      } else if (type === 'stepFontSize') {
        const currentPx = parseFloat(foundItem.fontSize || currentFontSize) || 15;
        const nextPx = `${Math.max(10, Math.min(96, currentPx + value))}px`;
        setCurrentFontSize(nextPx);
        updateItemOnPage(foundPage, foundItem.id, { fontSize: nextPx }, true);
      } else if (type === 'lineHeight') {
        setCurrentLineHeight(value);
        updateItemOnPage(foundPage, foundItem.id, { lineHeight: value }, true);
      } else if (type === 'foreColor') {
        setCurrentTextColor(value);
        updateItemOnPage(foundPage, foundItem.id, { textColor: value }, true);
      } else if (type === 'headingStyle') {
        setCurrentHeadingStyle(value);
        const sizeMap = { p: '15px', h1: '26px', h2: '21px', h3: '18px', quote: '15px' };
        const nextSize = sizeMap[value] || '15px';
        setCurrentFontSize(nextSize);
        updateItemOnPage(foundPage, foundItem.id, { fontSize: nextSize }, true);
      } else if (type === 'clearFormat') {
        setCurrentFontFamily("'Inter', sans-serif");
        setCurrentFontSize('15px');
        setCurrentLineHeight('1.5');
        setCurrentTextColor('#1e293b');
        updateItemOnPage(
          foundPage,
          foundItem.id,
          { fontFamily: "'Inter', sans-serif", fontSize: '15px', lineHeight: '1.5', textColor: '#1e293b' },
          true
        );
      }
    }

    if (!boxEl || !contentEl) return;

    if (document.activeElement !== contentEl) {
      contentEl.focus();
    }

    if (type === 'fontFamily') {
      contentEl.style.fontFamily = value;
      document.execCommand('fontName', false, value);
      setCurrentFontFamily(value);
    } else if (type === 'fontSizePx') {
      contentEl.style.fontSize = value;
      setCurrentFontSize(value);
    } else if (type === 'stepFontSize') {
      const currentPx = parseFloat(contentEl.style.fontSize || currentFontSize) || 15;
      const nextPx = `${Math.max(10, Math.min(96, currentPx + value))}px`;
      contentEl.style.fontSize = nextPx;
      setCurrentFontSize(nextPx);
    } else if (type === 'lineHeight') {
      contentEl.style.lineHeight = value;
      setCurrentLineHeight(value);
    } else if (type === 'foreColor') {
      contentEl.style.color = value;
      document.execCommand('foreColor', false, value);
      setCurrentTextColor(value);
    } else if (type === 'headingStyle') {
      setCurrentHeadingStyle(value);
      const sizeMap = { p: '15px', h1: '26px', h2: '21px', h3: '18px', quote: '15px' };
      const nextSize = sizeMap[value] || '15px';
      contentEl.style.fontSize = nextSize;
      contentEl.style.fontWeight = value.startsWith('h') ? '700' : '400';
      contentEl.style.fontStyle = value === 'quote' ? 'italic' : 'normal';
      setCurrentFontSize(nextSize);
    } else if (type === 'changeCase') {
      const txt = contentEl.innerText || '';
      if (value === 'upper') contentEl.innerText = txt.toUpperCase();
      else if (value === 'lower') contentEl.innerText = txt.toLowerCase();
      else if (value === 'title') {
        contentEl.innerText = txt.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      }
      if (foundItem && foundPage !== null) {
        updateItemOnPage(foundPage, foundItem.id, { html: contentEl.innerHTML }, true);
      }
    } else if (type === 'clearFormat') {
      document.execCommand('removeFormat', false, null);
      contentEl.style.fontFamily = "'Inter', sans-serif";
      contentEl.style.fontSize = '15px';
      contentEl.style.lineHeight = '1.5';
      contentEl.style.color = '#1e293b';
      contentEl.style.fontWeight = '400';
      contentEl.style.fontStyle = 'normal';
      setCurrentFontFamily("'Inter', sans-serif");
      setCurrentFontSize('15px');
      setCurrentLineHeight('1.5');
      setCurrentTextColor('#1e293b');
      setCurrentHighlightColor('transparent');
      setActiveStyles({
        bold: false,
        italic: false,
        underline: false,
        strikeThrough: false,
        subscript: false,
        superscript: false,
        insertUnorderedList: false,
        insertOrderedList: false,
        justifyLeft: true,
        justifyCenter: false,
        justifyRight: false,
        justifyFull: false
      });
    } else if (type === 'indent' || type === 'outdent') {
      document.execCommand(type, false, null);
    }

    if (foundItem && foundPage !== null) {
      updateItemOnPage(foundPage, foundItem.id, { html: contentEl.innerHTML }, false);
    } else {
      saveActiveTextBoxContent();
    }
  };
  // Sayfaya Etkileşimli Metin Kutusu veya Şekil Ekleme (Tam Kontrollü React State ile)
  const insertTextBox = (initialShape = 'default', initialColor = null) => {
    const boxId = 'tb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const defaultColors = {
      default: 'transparent',
      sticky: '#fef08a',
      frame: '#f8fafc',
      ribbon: '#e0f2fe',
      heart: '#ffe4e6',
      bubble: '#e0f2fe',
      star: '#fef3c7',
      hexagon: '#f3e8ff',
      oval: '#dcfce7',
      torn: '#fef9c3',
      rect: '#bae6fd',
      circle: '#fbcfe8',
      triangle: '#fde047',
      diamond: '#ddd6fe',
      arrow: '#bbf7d0'
    };
    const finalBg = initialColor || defaultColors[initialShape] || 'transparent';
    const isCenteredShape = ['heart', 'star', 'hexagon', 'oval', 'circle', 'triangle', 'diamond', 'arrow', 'ribbon'].includes(initialShape);

    const onLeftOrCover = isCoverView || activeEditorTarget === 'left';
    const targetPage = onLeftOrCover ? currentLeftPage : currentRightPage;
    const existingCount = (pageItemsRef.current[targetPage] || []).length;
    const offset = (existingCount * 18) % 120;

    const newItem = {
      id: boxId,
      shape: initialShape,
      bgColor: finalBg,
      opacity: 100,
      x: 56 + offset,
      y: 110 + offset,
      width: isCenteredShape ? 170 : 230,
      height: isCenteredShape ? 150 : 96,
      rotation: 0,
      html: '',
      fontFamily: "'Inter', sans-serif",
      fontSize: '15px',
      lineHeight: '1.5',
      textColor: '#1e293b',
      textAlign: isCenteredShape ? 'center' : 'left'
    };

    document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));

    persistPageItems((prev) => ({
      ...prev,
      [targetPage]: [...(prev[targetPage] || []), newItem]
    }), true);

    setActiveTextBoxId(boxId);
    setActiveTableCell(null);
    setSelectedImageId(null);
    setSelectedImageOpacity(null);
    selectedImageElementRef.current = null;
    setCurrentBoxBgColor(finalBg);
    setCurrentBoxShape(initialShape);
    setCurrentBoxOpacity(100);
    setCurrentFontFamily("'Inter', sans-serif");
    setCurrentFontSize('15px');
    setCurrentTextColor('#1e293b');
    setCurrentLineHeight('1.5');
    setActiveStyles({
      bold: false,
      italic: false,
      underline: false,
      strikeThrough: false,
      subscript: false,
      superscript: false,
      insertUnorderedList: false,
      insertOrderedList: false,
      justifyLeft: !isCenteredShape,
      justifyCenter: isCenteredShape,
      justifyRight: false,
      justifyFull: false
    });

    requestAnimationFrame(() => {
      const el = document.getElementById(boxId);
      if (el) {
        activeTextBoxElementRef.current = el;
        if (initialShape === 'default') {
          el.querySelector<HTMLElement>('.agenda-textbox-content')?.focus();
        }
      }
    });
  };

  // Sayfaya Etkileşimli Tablo Ekleme
  const insertTableBox = (rows = 3, cols = 3, initialBg = '#ffffff') => {
    const safeRows = Math.max(1, Math.min(12, Number(rows) || 3));
    const safeCols = Math.max(1, Math.min(8, Number(cols) || 3));
    const boxId = 'tb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    const onLeftOrCover = isCoverView || activeEditorTarget === 'left';
    const targetPage = onLeftOrCover ? currentLeftPage : currentRightPage;
    const existingCount = (pageItemsRef.current[targetPage] || []).length;
    const offset = (existingCount * 18) % 100;

    const initialCells = Array.from({ length: safeRows }, () =>
      Array.from({ length: safeCols }, () => '')
    );

    const defaultWidth = Math.min(390, Math.max(200, safeCols * 78));
    const defaultHeight = Math.min(440, Math.max(96, safeRows * 36 + 34));

    const newItem = {
      id: boxId,
      itemType: 'table',
      shape: 'default',
      bgColor: initialBg,
      borderColor: '#94a3b8',
      headerBg: '#f1f5f9',
      hasHeader: true,
      rows: safeRows,
      cols: safeCols,
      cells: initialCells,
      opacity: 100,
      x: 44 + offset,
      y: 100 + offset,
      width: defaultWidth,
      height: defaultHeight,
      rotation: 0,
      html: '',
      fontFamily: "'Inter', sans-serif",
      fontSize: '13px',
      lineHeight: '1.35',
      textColor: '#1e293b',
      textAlign: 'left'
    };

    document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));

    persistPageItems((prev) => ({
      ...prev,
      [targetPage]: [...(prev[targetPage] || []), newItem]
    }), true);

    setActiveTextBoxId(boxId);
    setActiveTableCell({ boxId, row: 0, col: 0 });
    setSelectedImageId(null);
    setSelectedImageOpacity(null);
    selectedImageElementRef.current = null;
    setCurrentBoxBgColor(initialBg);
    setCurrentBoxShape('default');
    setCurrentBoxOpacity(100);
    setCurrentFontFamily("'Inter', sans-serif");
    setCurrentFontSize('13px');
    setCurrentTextColor('#1e293b');
    setCurrentLineHeight('1.35');
  };

  // Tablo Satır / Sütun Ekleme, Çıkarma ve Hücre Güncelleme Yardımcıları
  const modifyTableStructure = (pageNum, item, action) => {
    const curRows = item.rows || (item.cells ? item.cells.length : 3);
    const curCols = item.cols || (item.cells?.[0] ? item.cells[0].length : 3);
    const prevCells = Array.from({ length: curRows }, (_, r) =>
      Array.from({ length: curCols }, (_, c) => item.cells?.[r]?.[c] ?? '')
    );

    let nextCells = prevCells.map((row) => [...row]);
    if (action === 'addRow' && nextCells.length < 15) {
      nextCells.push(Array.from({ length: curCols }, () => ''));
    } else if (action === 'removeRow' && nextCells.length > 1) {
      nextCells.pop();
    } else if (action === 'addCol' && curCols < 10) {
      nextCells = nextCells.map((row) => [...row, '']);
    } else if (action === 'removeCol' && curCols > 1) {
      nextCells = nextCells.map((row) => row.slice(0, -1));
    } else if (action === 'toggleHeader') {
      updateItemOnPage(pageNum, item.id, { hasHeader: !item.hasHeader }, true);
      return;
    }

    updateItemOnPage(
      pageNum,
      item.id,
      {
        rows: nextCells.length,
        cols: nextCells[0]?.length || 1,
        cells: nextCells
      },
      true
    );
  };

  const updateTableCellText = (pageNum, item, rIdx, cIdx, htmlVal, recordUndo = false) => {
    const curRows = item.rows || (item.cells ? item.cells.length : 3);
    const curCols = item.cols || (item.cells?.[0] ? item.cells[0].length : 3);
    const nextCells = Array.from({ length: curRows }, (_, r) =>
      Array.from({ length: curCols }, (_, c) => {
        if (r === rIdx && c === cIdx) return htmlVal;
        return item.cells?.[r]?.[c] ?? '';
      })
    );
    updateItemOnPage(pageNum, item.id, { cells: nextCells }, recordUndo);
  };

  // ARAÇ: Görsel Ekleme (Tam Kontrollü React State ile - Asla Takılmaz, Geri Atmaz ve Her Yere Serbestçe Taşınır)
  const placeImageOnActivePage = (imageSrc, customDimensions = null) => {
    if (!imageSrc) return;

    const probeImg = new Image();
    probeImg.onload = () => {
      const natW = probeImg.naturalWidth || 220;
      const natH = probeImg.naturalHeight || 220;
      const initW = customDimensions?.width ? Math.round(customDimensions.width) : 220;
      const initH = customDimensions?.height
        ? Math.round(customDimensions.height)
        : Math.max(60, Math.round((initW * natH) / Math.max(1, natW)));

      const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const onLeftOrCover = isCoverView || activeEditorTarget === 'left';
      const targetPage = onLeftOrCover ? currentLeftPage : currentRightPage;
      const existingCount = (pageItemsRef.current[targetPage] || []).length;
      const offset = (existingCount * 18) % 100;

      const newItem = {
        id: imgId,
        itemType: 'image',
        src: imageSrc,
        originalSrc: imageSrc,
        opacity: 100,
        x: 64 + offset,
        y: 120 + offset,
        width: initW,
        height: initH,
        rotation: 0
      };

      document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));

      persistPageItems((prev) => ({
        ...prev,
        [targetPage]: [...(prev[targetPage] || []), newItem]
      }), true);

      setActiveTextBoxId(null);
      setActiveTableCell(null);
      activeTextBoxElementRef.current = null;
      selectedImageElementRef.current = { itemId: imgId, pageNum: targetPage };
      setSelectedImageId(imgId);
      setSelectedImageOpacity(100);
    };
    probeImg.src = imageSrc;
  };

  // Seçili Kayıtlı Görselden Farenin İzlediği Serbest Yola Bant (Washi Tape) Yerleştirme
  const placeImageTapePathOnPage = (imageSrc, points, customDimensions = null) => {
    const bookEl = document.getElementById('agenda-book');
    if (!bookEl || !imageSrc || !points || points.length < 2) return;

    const probeImg = new Image();
    probeImg.onload = () => {
      const natW = probeImg.naturalWidth || 160;
      const natH = probeImg.naturalHeight || 160;
      const maxDim = 220;
      const scale = natW > maxDim || natH > maxDim ? maxDim / Math.max(natW, natH) : 1;
      const itemW = customDimensions?.width
        ? Math.max(20, Math.round(customDimensions.width))
        : Math.max(40, Math.round(natW * scale));
      const itemH = customDimensions?.height
        ? Math.max(20, Math.round(customDimensions.height))
        : customDimensions?.width
        ? Math.max(20, Math.round((customDimensions.width * natH) / Math.max(1, natW)))
        : Math.max(40, Math.round(natH * scale));
      const pad = Math.ceil(Math.max(itemW, itemH) * 0.65);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      points.forEach((pt) => {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      });

      const boxLeft = Math.floor(minX - pad);
      const boxTop = Math.floor(minY - pad);
      const boxWidth = Math.max(itemW + 16, Math.ceil(maxX - minX + pad * 2));
      const boxHeight = Math.max(itemH + 16, Math.ceil(maxY - minY + pad * 2));

      const midX = boxLeft + boxWidth / 2;
      const bookRect = bookEl.getBoundingClientRect();
      const bookMidX = bookRect.width / 2;
      const onLeftOrCover = isCoverView || midX < bookMidX;
      const targetPage = onLeftOrCover ? currentLeftPage : currentRightPage;

      const localLeft = Math.round(onLeftOrCover ? boxLeft : boxLeft - bookMidX);
      const localTop = Math.round(boxTop);

      const stampsHtml = [];
      let carryDist = 0;
      const stepSpacing = Math.max(24, itemW);

      for (let i = 1; i < points.length; i++) {
        const p1 = points[i - 1];
        const p2 = points[i];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 0.5) continue;

        const angleDeg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
        let distAlong = carryDist;

        while (distAlong <= segLen) {
          const t = distAlong / segLen;
          const cx = p1.x + dx * t - boxLeft;
          const cy = p1.y + dy * t - boxTop;
          stampsHtml.push(
            `<div style="position: absolute; left: ${Math.round(cx - itemW / 2)}px; top: ${Math.round(cy - itemH / 2)}px; width: ${itemW}px; height: ${itemH}px; transform: rotate(${angleDeg}deg); transform-origin: center center; background-image: url('${imageSrc}'); background-size: contain; background-repeat: no-repeat; background-position: center; pointer-events: none;"></div>`
          );
          distAlong += stepSpacing;
        }
        carryDist = distAlong - segLen;
      }

      if (stampsHtml.length === 0) return;

      const tapeId = 'tape_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const newTapeItem = {
        id: tapeId,
        itemType: 'tape',
        stampsHtml: stampsHtml.join(''),
        opacity: 100,
        x: localLeft,
        y: localTop,
        width: boxWidth,
        height: boxHeight,
        rotation: 0
      };

      document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));

      persistPageItems((prev) => ({
        ...prev,
        [targetPage]: [...(prev[targetPage] || []), newTapeItem]
      }), true);

      setActiveTextBoxId(null);
      setActiveTableCell(null);
      activeTextBoxElementRef.current = null;
      selectedImageElementRef.current = { itemId: tapeId, pageNum: targetPage };
      setSelectedImageId(tapeId);
      setSelectedImageOpacity(100);
    };
    probeImg.src = imageSrc;
  };

  // Bilgisayardan Resim Yükleme ve Bant Çekme Etkileşim İşleyicileri
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (dataUrl) {
        placeImageOnActivePage(dataUrl);
        saveImageToGallery(dataUrl, file.name ? file.name.replace(/\.[^/.]+$/, '') : 'Yüklenen Görsel');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleTapeDrawMouseDown = (e) => {
    if (!selectedTapeImage) return;
    e.preventDefault();
    e.stopPropagation();
    const bookEl = document.getElementById('agenda-book');
    if (!bookEl) return;
    const rect = bookEl.getBoundingClientRect();
    const startPt = { x: e.clientX - rect.left, y: e.clientY - rect.top, angle: 0 };
    tapeDragRef.current = [startPt];
    lastTapeStampRef.current = startPt;
    setTapeDragPoints([startPt]);

    const handleTapeMove = (moveEvent) => {
      const curX = moveEvent.clientX - rect.left;
      const curY = moveEvent.clientY - rect.top;
      const last = lastTapeStampRef.current || startPt;
      const dist = Math.hypot(curX - last.x, curY - last.y);
      if (dist >= 14) {
        const angle = Math.round(((Math.atan2(curY - last.y, curX - last.x) * 180) / Math.PI) * 10) / 10;
        const nextPt = { x: curX, y: curY, angle };
        tapeDragRef.current = [...tapeDragRef.current, nextPt];
        lastTapeStampRef.current = nextPt;
        setTapeDragPoints([...tapeDragRef.current]);
      }
    };

    const handleTapeUp = () => {
      window.removeEventListener('mousemove', handleTapeMove);
      window.removeEventListener('mouseup', handleTapeUp);
      const pts = tapeDragRef.current;
      if (pts && pts.length >= 2 && selectedTapeImage) {
        placeImageTapePathOnPage(selectedTapeImage.src, pts, {
          width: selectedTapeImage.width,
          height: selectedTapeImage.height
        });
      }
      setTapeDragPoints([]);
      tapeDragRef.current = [];
      lastTapeStampRef.current = null;
    };

    window.addEventListener('mousemove', handleTapeMove);
    window.addEventListener('mouseup', handleTapeUp);
  };

  // Sayfa Kenarından Sürükleyerek 3D Sayfa Çevirme Başlatıcı
  const startEdgeCurl = (e, direction) => {
    if (penMode || selectedTapeImage) return;
    if (direction === 'next' && !isCoverView && currentRightPage >= TOTAL_PAGES) return;
    if (direction === 'prev' && currentLeftPage <= 0) return;
    e.preventDefault();
    e.stopPropagation();

    const bookEl = document.getElementById('agenda-book');
    if (!bookEl) return;
    const bookRect = bookEl.getBoundingClientRect();
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const spanW = isCoverView ? bookRect.width : bookRect.width / 2;

    curlDragRef.current = { direction, startX, startY };
    currentTurnProgressRef.current = 0.04;
    setPageTurn({ direction, progress: 0.04, curlTilt: 0 });

    const onCurlMove = (ev) => {
      if (!curlDragRef.current) return;
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const rawDelta = direction === 'next' ? startX - cx : cx - startX;
      const progress = Math.max(0.02, Math.min(0.98, rawDelta / Math.max(120, spanW)));
      const tilt = Math.max(-8, Math.min(8, ((cy - startY) / Math.max(100, bookRect.height)) * 12));
      currentTurnProgressRef.current = progress;
      setPageTurn({ direction, progress, curlTilt: tilt });
    };

    const onCurlEnd = () => {
      window.removeEventListener('mousemove', onCurlMove);
      window.removeEventListener('mouseup', onCurlEnd);
      window.removeEventListener('touchmove', onCurlMove);
      window.removeEventListener('touchend', onCurlEnd);
      const p = currentTurnProgressRef.current;
      curlDragRef.current = null;
      if (p >= 0.25) {
        animateTurnTo(direction, p, 1, () => commitPageTurn(direction));
      } else {
        animateTurnTo(direction, p, 0, null);
      }
    };

    window.addEventListener('mousemove', onCurlMove);
    window.addEventListener('mouseup', onCurlEnd);
    window.addEventListener('touchmove', onCurlMove, { passive: false });
    window.addEventListener('touchend', onCurlEnd);
  };

  // Cetvel ve Masa Üstü Öğeleri Sürükleme/Döndürme/Boyutlandırma Dinleyicisi
  useEffect(() => {
    const onGlobalDragMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;

      if (rulerDragRef.current) {
        const rd = rulerDragRef.current;
        if (rd.mode === 'move') {
          setRulerState((prev) => ({
            ...prev,
            x: Math.round(rd.initialX + (cx - rd.startX)),
            y: Math.round(rd.initialY + (cy - rd.startY))
          }));
        } else if (rd.mode === 'rotate') {
          const rad = Math.atan2(cy - rd.centerY, cx - rd.centerX);
          let deg = Math.round((rad * 180) / Math.PI);
          deg = ((deg % 360) + 360) % 360;
          for (const snap of [0, 90, 180, 270, 360]) {
            if (Math.abs(deg - snap) <= 4) {
              deg = snap === 360 ? 0 : snap;
              break;
            }
          }
          setRulerState((prev) => ({ ...prev, angle: deg }));
        } else if (rd.mode === 'resize-right' || rd.mode === 'resize-left') {
          const rad = ((rd.angle || 0) * Math.PI) / 180;
          const along = (cx - rd.startX) * Math.cos(rad) + (cy - rd.startY) * Math.sin(rad);
          const deltaW = rd.mode === 'resize-right' ? along : -along;
          const nextW = Math.max(180, Math.min(920, Math.round(rd.initialWidth + deltaW)));
          const shift = ((nextW - rd.initialWidth) / 2) * (rd.mode === 'resize-right' ? 1 : -1);
          setRulerState((prev) => ({
            ...prev,
            width: nextW,
            x: Math.round(rd.initialX + shift * Math.cos(rad)),
            y: Math.round(rd.initialY + shift * Math.sin(rad))
          }));
        }
      }

      if (deskItemDragRef.current) {
        const dd = deskItemDragRef.current;
        if (dd.mode === 'move') {
          updateDeskItems((prev) =>
            prev.map((it) =>
              it.id === dd.id
                ? { ...it, x: Math.round(dd.initialX + (cx - dd.startX)), y: Math.round(dd.initialY + (cy - dd.startY)) }
                : it
            )
          );
        } else if (dd.mode === 'rotate') {
          const rad = Math.atan2(cy - dd.centerY, cx - dd.centerX);
          const deg = ((Math.round((rad * 180) / Math.PI + 90) % 360) + 360) % 360;
          updateDeskItems((prev) => prev.map((it) => (it.id === dd.id ? { ...it, angle: deg } : it)));
        } else if (dd.mode === 'resize') {
          const nextW = Math.max(48, Math.round(dd.initialW + (cx - dd.startX)));
          const nextH = Math.max(48, Math.round(dd.initialH + (cy - dd.startY)));
          updateDeskItems((prev) => prev.map((it) => (it.id === dd.id ? { ...it, width: nextW, height: nextH } : it)));
        }
      }
    };

    const onGlobalDragEnd = () => {
      rulerDragRef.current = null;
      deskItemDragRef.current = null;
    };

    window.addEventListener('mousemove', onGlobalDragMove);
    window.addEventListener('mouseup', onGlobalDragEnd);
    window.addEventListener('touchmove', onGlobalDragMove, { passive: false });
    window.addEventListener('touchend', onGlobalDragEnd);
    return () => {
      window.removeEventListener('mousemove', onGlobalDragMove);
      window.removeEventListener('mouseup', onGlobalDragEnd);
      window.removeEventListener('touchmove', onGlobalDragMove);
      window.removeEventListener('touchend', onGlobalDragEnd);
    };
  }, []);

  // Resim Arkaplanını Gelişmiş CIE Lab Kümeleme + İç Boşluk Algılama + Yumuşak Kenar Geçişi ile Kaldırma Fonksiyonu
  const processRemoveBackground = (sourceDataUrl, tolerance = 32) => {
    setIsProcessingBg(true);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const w = canvas.width;
      const h = canvas.height;
      const totalPixels = w * h;

      // RGB -> CIE Lab dönüşümü (insan gözü algısına en yakın renk ayrımı)
      const rgbToLab = (r, g, b) => {
        let sr = r / 255;
        let sg = g / 255;
        let sb = b / 255;
        sr = sr > 0.04045 ? Math.pow((sr + 0.055) / 1.055, 2.4) : sr / 12.92;
        sg = sg > 0.04045 ? Math.pow((sg + 0.055) / 1.055, 2.4) : sg / 12.92;
        sb = sb > 0.04045 ? Math.pow((sb + 0.055) / 1.055, 2.4) : sb / 12.92;

        let x = (sr * 0.4124 + sg * 0.3576 + sb * 0.1805) / 0.95047;
        let y = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 1.0;
        let z = (sr * 0.0193 + sg * 0.1192 + sb * 0.9505) / 1.08883;

        x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
        y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
        z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

        return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
      };

      // Tüm piksellerin Lab değerlerini önbelleğe al
      const labBuffer = new Float32Array(totalPixels * 3);
      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const [L, a, b] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
        labBuffer[i * 3] = L;
        labBuffer[i * 3 + 1] = a;
        labBuffer[i * 3 + 2] = b;
      }

      // Dış çerçeveden sık örnekleme yaparak baskın arka plan renk kümelerini (gradyan/gölgeli zeminler dahil) çıkar
      const borderSamples = [];
      const stepX = Math.max(1, Math.floor(w / 48));
      const stepY = Math.max(1, Math.floor(h / 48));
      const addSample = (px, py) => {
        const p = py * w + px;
        if (data[p * 4 + 3] < 20) return;
        borderSamples.push([labBuffer[p * 3], labBuffer[p * 3 + 1], labBuffer[p * 3 + 2]]);
      };
      for (let x = 0; x < w; x += stepX) {
        addSample(x, 0);
        if (h > 2) addSample(x, 1);
        addSample(x, h - 1);
        if (h > 2) addSample(x, h - 2);
      }
      for (let y = 0; y < h; y += stepY) {
        addSample(0, y);
        if (w > 2) addSample(1, y);
        addSample(w - 1, y);
        if (w > 2) addSample(w - 2, y);
      }

      // Benzer kenar örneklerini birleştirerek en fazla 12 temsilci arka plan tonu oluştur
      const bgClusters = [];
      for (let i = 0; i < borderSamples.length; i++) {
        const [L, a, b] = borderSamples[i];
        let merged = false;
        for (let c = 0; c < bgClusters.length; c++) {
          const cl = bgClusters[c];
          const d = Math.hypot(L - cl.L, a - cl.a, b - cl.b);
          if (d < 9.5) {
            cl.L = (cl.L * cl.count + L) / (cl.count + 1);
            cl.a = (cl.a * cl.count + a) / (cl.count + 1);
            cl.b = (cl.b * cl.count + b) / (cl.count + 1);
            cl.count += 1;
            merged = true;
            break;
          }
        }
        if (!merged && bgClusters.length < 16) {
          bgClusters.push({ L, a, b, count: 1 });
        }
      }
      bgClusters.sort((x, y) => y.count - x.count);
      const activeClusters = bgClusters.slice(0, 6);

      // Sobel kenar (gradyan) büyüklüğü: saç, yüz hatları ve kıyafet sınırlarını korumak için bariyer oluşturur
      const edgeMag = new Float32Array(totalPixels);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          const gx =
            -labBuffer[(p - w - 1) * 3] + labBuffer[(p - w + 1) * 3] +
            -2 * labBuffer[(p - 1) * 3] + 2 * labBuffer[(p + 1) * 3] +
            -labBuffer[(p + w - 1) * 3] + labBuffer[(p + w + 1) * 3];
          const gy =
            -labBuffer[(p - w - 1) * 3] - 2 * labBuffer[(p - w) * 3] - labBuffer[(p - w + 1) * 3] +
            labBuffer[(p + w - 1) * 3] + 2 * labBuffer[(p + w) * 3] + labBuffer[(p + w + 1) * 3];
          edgeMag[p] = Math.hypot(gx, gy) * 0.25;
        }
      }

      // Hassasiyet değerini Delta-E eşiğine dönüştür (varsayılan 32 için daha kontrollü ve güvenli eşik)
      const baseHardThreshold = Math.max(4.5, tolerance * 0.44);
      const baseSoftThreshold = baseHardThreshold + Math.max(5.0, tolerance * 0.2);

      // Ön Plan (Kişi, Yüz, Saç ve Kıyafet) Renk Profili Çıkarımı:
      // Portre/fotoğraflarda kişinin başı merkezde, kıyafeti ise orta ve alt-orta bölgede yer alır.
      const fgSamples = [];
      const fgStartX = Math.floor(w * 0.26);
      const fgEndX = Math.ceil(w * 0.74);
      const fgStartY = Math.floor(h * 0.16);
      const fgEndY = Math.ceil(h * 0.94);
      const fgStepX = Math.max(1, Math.floor((fgEndX - fgStartX) / 28));
      const fgStepY = Math.max(1, Math.floor((fgEndY - fgStartY) / 34));

      for (let y = fgStartY; y < fgEndY; y += fgStepY) {
        for (let x = fgStartX; x < fgEndX; x += fgStepX) {
          const p = y * w + x;
          if (data[p * 4 + 3] < 20) continue;
          const L = labBuffer[p * 3];
          const a = labBuffer[p * 3 + 1];
          const b = labBuffer[p * 3 + 2];
          // Arka plan kümelerinden belirgin şekilde ayrılan pikselleri ön plan (kıyafet/ten/saç) adayı olarak al
          let minBgD = 999;
          for (let c = 0; c < activeClusters.length; c++) {
            const cl = activeClusters[c];
            const d = Math.hypot(L - cl.L, a - cl.a, b - cl.b);
            if (d < minBgD) minBgD = d;
          }
          if (minBgD > baseSoftThreshold * 1.15) {
            fgSamples.push([L, a, b]);
          }
        }
      }

      // Ön plan örneklerini kıyafet/ten/saç renk kümelerine grupla
      const fgClusters = [];
      for (let i = 0; i < fgSamples.length; i++) {
        const [L, a, b] = fgSamples[i];
        let merged = false;
        for (let c = 0; c < fgClusters.length; c++) {
          const cl = fgClusters[c];
          const d = Math.hypot(L - cl.L, a - cl.a, b - cl.b);
          if (d < 12.0) {
            cl.L = (cl.L * cl.count + L) / (cl.count + 1);
            cl.a = (cl.a * cl.count + a) / (cl.count + 1);
            cl.b = (cl.b * cl.count + b) / (cl.count + 1);
            cl.count += 1;
            merged = true;
            break;
          }
        }
        if (!merged && fgClusters.length < 24) {
          fgClusters.push({ L, a, b, count: 1 });
        }
      }
      fgClusters.sort((x, y) => y.count - x.count);
      const activeFgClusters = fgClusters.slice(0, 12);

      const getMinFgDeltaE = (pos) => {
        if (activeFgClusters.length === 0) return 999;
        const L = labBuffer[pos * 3];
        const a = labBuffer[pos * 3 + 1];
        const b = labBuffer[pos * 3 + 2];
        let minD = 999;
        for (let c = 0; c < activeFgClusters.length; c++) {
          const cl = activeFgClusters[c];
          const d = Math.hypot(L - cl.L, a - cl.a, b - cl.b);
          if (d < minD) minD = d;
        }
        return minD;
      };

      // Lokal Doku / Varyans Haritası: Kıyafet kumaşı, dikiş ve desen dokusu düz arka plandan daha yüksek mikro-kontrasta sahiptir
      const localTexture = new Float32Array(totalPixels);
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const p = y * w + x;
          const cL = labBuffer[p * 3];
          const d1 = Math.abs(cL - labBuffer[(p - 2) * 3]) + Math.abs(cL - labBuffer[(p + 2) * 3]);
          const d2 = Math.abs(cL - labBuffer[(p - w * 2) * 3]) + Math.abs(cL - labBuffer[(p + w * 2) * 3]);
          localTexture[p] = (d1 + d2) * 0.25;
        }
      }

      // Kişi ve Kıyafet Silüeti Korumalı Konumsal Eşik Hesabı
      const getEffectiveThresholds = (pos) => {
        const px = pos % w;
        const py = (pos - px) / w;
        const nx = (px / Math.max(1, w - 1)) * 2 - 1; // -1 .. +1 (yatay)
        const ny = py / Math.max(1, h - 1); // 0 (üst) .. 1 (alt)

        // Kafa bölgesi (üst-orta) ve gövde/kıyafet bölgesi (alt-orta daha geniş) için anatomik silüet maskesi
        const bodyHalfWidth = ny < 0.35 ? 0.42 : 0.42 + ((ny - 0.35) / 0.65) * 0.34;
        const inTorsoOrHead = Math.abs(nx) < bodyHalfWidth && ny > 0.08;
        const silhouetteFactor = inTorsoOrHead ? 0.54 : 1.0;

        // Kıyafet/ten/saç renk profiline benziyorsa arka plan olarak silinmesini engelle
        const fgDist = getMinFgDeltaE(pos);
        const fgFactor = fgDist < 14 ? 0.38 : fgDist < 24 ? 0.68 : 1.0;

        // Kenar çizgisi veya kumaş dokusu varsa bariyer uygula
        const edgePenalty = edgeMag[pos] > 11 ? 0.30 : edgeMag[pos] > 6.5 ? 0.62 : 1.0;
        const texturePenalty = localTexture[pos] > 7.5 ? 0.55 : 1.0;

        const factor = silhouetteFactor * fgFactor * edgePenalty * texturePenalty;
        return {
          hard: baseHardThreshold * factor,
          soft: baseSoftThreshold * factor
        };
      };

      const getMinDeltaE = (pos) => {
        if (data[pos * 4 + 3] < 15) return 0;
        const L = labBuffer[pos * 3];
        const a = labBuffer[pos * 3 + 1];
        const b = labBuffer[pos * 3 + 2];
        let minD = 999;
        for (let c = 0; c < activeClusters.length; c++) {
          const cl = activeClusters[c];
          const d = Math.hypot(L - cl.L, a - cl.a, b - cl.b);
          if (d < minD) minD = d;
        }
        return minD;
      };

      const visited = new Uint8Array(totalPixels);
      const bgMask = new Uint8Array(totalPixels); // 2: kesin arka plan, 1: yumuşak geçiş kenarı
      const queue = new Int32Array(totalPixels);
      let head = 0;
      let tail = 0;

      // 1. Aşama: Yalnızca üst, sol ve sağ dış kenarlardan başlayıp kıyafet/saç sınırına çarpana kadar arka planı temizle
      // (Alt kenarın orta kısmı genellikle kıyafetin devamı olduğu için alt orta bölgeden taşma başlatılmaz)
      const trySeed = (pos) => {
        if (visited[pos]) return;
        const d = getMinDeltaE(pos);
        const { hard, soft } = getEffectiveThresholds(pos);
        if (d <= soft) {
          visited[pos] = 1;
          bgMask[pos] = d <= hard ? 2 : 1;
          if (d <= hard && edgeMag[pos] <= 12) {
            queue[tail++] = pos;
          }
        }
      };

      for (let x = 0; x < w; x++) {
        trySeed(x);
        const nx = (x / Math.max(1, w - 1)) * 2 - 1;
        // Alt kenarda yalnızca kıyafet dışındaki sol/sağ köşe bölgelerinden arka plan girişi yap
        if (Math.abs(nx) > 0.68) {
          trySeed((h - 1) * w + x);
        }
      }
      for (let y = 0; y < h; y++) {
        trySeed(y * w);
        trySeed(y * w + (w - 1));
      }

      while (head < tail) {
        const pos = queue[head++];
        const px = pos % w;
        const py = (pos - px) / w;
        const curL = labBuffer[pos * 3];
        const curA = labBuffer[pos * 3 + 1];
        const curB = labBuffer[pos * 3 + 2];

        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx;
            if (nx < 0 || nx >= w) continue;
            const nPos = ny * w + nx;
            if (visited[nPos]) continue;

            // Komşu pikselle ani renk sıçraması varsa (kıyafet/saç sınırı) içeri girme
            const stepDiff = Math.hypot(
              labBuffer[nPos * 3] - curL,
              labBuffer[nPos * 3 + 1] - curA,
              labBuffer[nPos * 3 + 2] - curB
            );
            if (stepDiff > Math.max(9.5, baseHardThreshold * 0.72)) continue;

            const d = getMinDeltaE(nPos);
            const { hard, soft } = getEffectiveThresholds(nPos);
            if (d <= soft) {
              visited[nPos] = 1;
              if (d <= hard && edgeMag[nPos] <= 12) {
                bgMask[nPos] = 2;
                queue[tail++] = nPos;
              } else {
                bgMask[nPos] = 1;
              }
            }
          }
        }
      }

      // 2. Aşama: Alfa kanalını yumuşak kenar geçişiyle (alpha feathering) uygula (içerideki saç/kıyafet tonlarına dokunulmaz)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const pos = y * w + x;
          const idx = pos * 4;
          if (bgMask[pos] === 2) {
            data[idx + 3] = 0;
          } else if (bgMask[pos] === 1) {
            const d = getMinDeltaE(pos);
            const { hard, soft } = getEffectiveThresholds(pos);
            const ratio = Math.max(0, Math.min(1, (d - hard) / Math.max(1, soft - hard)));
            data[idx + 3] = Math.round(data[idx + 3] * (0.25 + 0.75 * ratio * ratio));
          } else if (data[idx + 3] > 0 && x > 0 && x < w - 1 && y > 0 && y < h - 1) {
            // Arka plana komşu sınır piksellerinde mikro yumuşatma uygula
            let clearedNeighbors = 0;
            if (bgMask[pos - 1] === 2) clearedNeighbors++;
            if (bgMask[pos + 1] === 2) clearedNeighbors++;
            if (bgMask[pos - w] === 2) clearedNeighbors++;
            if (bgMask[pos + w] === 2) clearedNeighbors++;
            if (clearedNeighbors >= 2) {
              data[idx + 3] = Math.round(data[idx + 3] * 0.72);
            }
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const resultUrl = canvas.toDataURL('image/png');
      setBgRemovedPreviewSrc(resultUrl);
      setIsProcessingBg(false);
    };
    img.src = sourceDataUrl;
  };

  // Elle Fırça ile Silme / Geri Getirme Canvas Hazırlığı
  useEffect(() => {
    if (!editingImageModal || !manualBrushMode) return;
    const activeSrc = bgRemovedPreviewSrc || editingImageModal.currentSrc;

    // Orijinal resmi geri getirme (restore) fırçası için belleğe yükle
    const origImg = new Image();
    origImg.crossOrigin = 'anonymous';
    origImg.onload = () => {
      originalImgObjRef.current = origImg;
    };
    origImg.src = editingImageModal.originalSrc;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = brushCanvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = activeSrc;
  }, [editingImageModal, manualBrushMode]);

  // Elle Fırça Darbesi Uygulama (Silgi veya Orijinali Geri Getir)
  const applyManualBrushStroke = (clientX, clientY, isStart = false) => {
    const canvas = brushCanvasRef.current;
    if (!canvas || !manualBrushMode) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const scaledRadius = (brushSize * scaleX) / 2;

    const ctx = canvas.getContext('2d');
    const prevPt = isStart || !lastBrushPointRef.current ? { x, y } : lastBrushPointRef.current;

    if (manualBrushMode === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = scaledRadius * 2;
      ctx.beginPath();
      ctx.moveTo(prevPt.x, prevPt.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, scaledRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (manualBrushMode === 'restore' && originalImgObjRef.current) {
      ctx.save();
      ctx.beginPath();
      const dist = Math.hypot(x - prevPt.x, y - prevPt.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, scaledRadius * 0.35)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ix = prevPt.x + (x - prevPt.x) * t;
        const iy = prevPt.y + (y - prevPt.y) * t;
        ctx.moveTo(ix + scaledRadius, iy);
        ctx.arc(ix, iy, scaledRadius, 0, Math.PI * 2);
      }
      ctx.clip();
      ctx.drawImage(originalImgObjRef.current, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    lastBrushPointRef.current = { x, y };
  };

  const finishManualBrushStroke = () => {
    if (!isBrushingRef.current) return;
    isBrushingRef.current = false;
    lastBrushPointRef.current = null;
    if (brushCanvasRef.current) {
      const updatedUrl = brushCanvasRef.current.toDataURL('image/png');
      setBgRemovedPreviewSrc(updatedUrl);
    }
  };

  // Kırpma Çerçevesi Sürükleme / Boyutlandırma Takipçisi
  useEffect(() => {
    const handleCropMove = (e) => {
      if (!cropDragRef.current || !cropContainerRef.current) return;
      const { mode, startX, startY, startRect } = cropDragRef.current;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      if (e.cancelable && e.touches) e.preventDefault();

      const bounds = cropContainerRef.current.getBoundingClientRect();
      const dxPct = ((clientX - startX) / bounds.width) * 100;
      const dyPct = ((clientY - startY) / bounds.height) * 100;

      if (mode === 'move') {
        const nextX = Math.max(0, Math.min(100 - startRect.width, startRect.x + dxPct));
        const nextY = Math.max(0, Math.min(100 - startRect.height, startRect.y + dyPct));
        setCropRect({ ...startRect, x: nextX, y: nextY });
      } else if (mode === 'se') {
        let nextW = Math.max(12, Math.min(100 - startRect.x, startRect.width + dxPct));
        let nextH = Math.max(12, Math.min(100 - startRect.y, startRect.height + dyPct));
        if (cropAspect !== 'free') {
          const ratioMap = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };
          const targetRatio = ratioMap[cropAspect];
          const containerRatio = bounds.width / bounds.height;
          nextH = (nextW * containerRatio) / targetRatio;
          if (startRect.y + nextH > 100) {
            nextH = 100 - startRect.y;
            nextW = (nextH * targetRatio) / containerRatio;
          }
        }
        setCropRect({ ...startRect, width: nextW, height: nextH });
      } else if (mode === 'nw') {
        const maxX = startRect.x + startRect.width - 12;
        const maxY = startRect.y + startRect.height - 12;
        const nextX = Math.max(0, Math.min(maxX, startRect.x + dxPct));
        const nextY = Math.max(0, Math.min(maxY, startRect.y + dyPct));
        const nextW = startRect.width + (startRect.x - nextX);
        const nextH = startRect.height + (startRect.y - nextY);
        setCropRect({ x: nextX, y: nextY, width: nextW, height: nextH });
      }
    };

    const handleCropEnd = () => {
      cropDragRef.current = null;
    };

    window.addEventListener('mousemove', handleCropMove);
    window.addEventListener('mouseup', handleCropEnd);
    window.addEventListener('touchmove', handleCropMove, { passive: false });
    window.addEventListener('touchend', handleCropEnd);
    return () => {
      window.removeEventListener('mousemove', handleCropMove);
      window.removeEventListener('mouseup', handleCropEnd);
      window.removeEventListener('touchmove', handleCropMove);
      window.removeEventListener('touchend', handleCropEnd);
    };
  }, [cropAspect]);

  // Kırpma ve Arkaplan Kaldırma Değişikliklerini Resme Uygula
  const applyImageEdits = (alsoSaveToGallery = false) => {
    if (!editingImageModal) return;
    const { wrapperEl, imgEl, itemId, pageNum, currentSrc } = editingImageModal;
    const canvasDataUrl =
      manualBrushMode && brushCanvasRef.current
        ? brushCanvasRef.current.toDataURL('image/png')
        : null;
    const activeSource = canvasDataUrl || bgRemovedPreviewSrc || currentSrc;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;

      const sx = Math.round((cropRect.x / 100) * natW);
      const sy = Math.round((cropRect.y / 100) * natH);
      const sw = Math.max(10, Math.round((cropRect.width / 100) * natW));
      const sh = Math.max(10, Math.round((cropRect.height / 100) * natH));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const finalDataUrl = canvas.toDataURL('image/png');

      if (itemId && pageNum !== undefined && pageNum !== null) {
        updateItemOnPage(pageNum, itemId, { src: finalDataUrl }, true);
      } else if (imgEl) {
        imgEl.src = finalDataUrl;
        if (bgRemovedPreviewSrc || canvasDataUrl) {
          imgEl.style.boxShadow = 'none';
        }
        if (leftEditorRef.current && leftEditorRef.current.contains(wrapperEl)) {
          saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
        } else if (!isCoverView && rightEditorRef.current && rightEditorRef.current.contains(wrapperEl)) {
          saveContent(currentRightPage, rightEditorRef.current.innerHTML);
        }
      }

      if (alsoSaveToGallery) {
        saveImageToGallery(finalDataUrl, 'Düzenlenen Görsel');
      }

      setEditingImageModal(null);
      setBgRemovedPreviewSrc(null);
      setManualBrushMode(null);
    };
    img.src = activeSource;
  };

  // Global Sürükleme, Döndürme ve Boyutlandırma Takibi
  useEffect(() => {
    const handleMove = (e) => {
      if (!interactionStateRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const { type, targetBox, startX, startY, initialWidth, initialHeight, initialLeft, initialTop, initialFontSize } =
        interactionStateRef.current;

      if (type === 'rotate') {
        const { centerX, centerY, itemId, itemPage } = interactionStateRef.current;
        const rad = Math.atan2(clientY - centerY, clientX - centerX);
        let deg = Math.round(rad * (180 / Math.PI) - 90);
        deg = ((deg % 360) + 360) % 360;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
          if (deg === 360) deg = 0;
        }
        if (itemId && itemPage !== undefined) {
          updateItemOnPage(itemPage, itemId, { rotation: deg }, false);
        } else {
          targetBox.style.transform = `rotate(${deg}deg)`;
          targetBox.setAttribute('data-rotation', String(deg));
        }
        const badge = targetBox.querySelector('.rotate-angle-badge');
        if (badge) {
          badge.textContent = `${deg}°`;
          badge.style.opacity = '1';
        }
      } else if (type === 'resize') {
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        const { resizeDir = 'se', itemId, itemPage } = interactionStateRef.current;
        const isImage = targetBox.classList.contains('agenda-image-wrapper');
        const minW = 56;
        const minH = isImage ? 44 : 48;

        let newW = initialWidth;
        let newH = initialHeight;
        let newLeft = initialLeft;
        let newTop = initialTop;

        if (resizeDir.includes('e')) {
          newW = Math.max(minW, initialWidth + deltaX);
        }
        if (resizeDir.includes('w')) {
          const maxDeltaX = initialWidth - minW;
          const clampedDx = Math.min(maxDeltaX, deltaX);
          newW = initialWidth - clampedDx;
          newLeft = initialLeft + clampedDx;
        }
        if (resizeDir.includes('s')) {
          newH = Math.max(minH, initialHeight + deltaY);
        }
        if (resizeDir.includes('n')) {
          const maxDeltaY = initialHeight - minH;
          const clampedDy = Math.min(maxDeltaY, deltaY);
          newH = initialHeight - clampedDy;
          newTop = initialTop + clampedDy;
        }

        if (isImage && resizeDir.length === 2 && e.shiftKey && initialHeight > 0) {
          const aspect = initialWidth / initialHeight;
          newH = Math.max(minH, Math.round(newW / aspect));
          if (resizeDir.includes('n')) {
            newTop = initialTop + (initialHeight - newH);
          }
        }

        if (itemId && itemPage !== undefined) {
          const patch: { width: number; height: number; x: number; y: number; fontSize?: string } = {
            width: Math.round(newW),
            height: Math.round(newH),
            x: Math.round(newLeft),
            y: Math.round(newTop)
          };
          if (initialFontSize) {
            const scaleFactor = Math.sqrt((newW / initialWidth) * (newH / initialHeight));
            const newFontPx = `${Math.max(10, Math.min(96, Math.round(initialFontSize * scaleFactor)))}px`;
            patch.fontSize = newFontPx;
            setCurrentFontSize(newFontPx);
          }
          updateItemOnPage(itemPage, itemId, patch, false);
          return;
        }

        targetBox.style.width = `${Math.round(newW)}px`;
        targetBox.style.height = `${Math.round(newH)}px`;
        if (isImage) {
          const targetImg = targetBox.querySelector('.agenda-image-target');
          if (targetImg) {
            targetImg.style.width = `${Math.round(newW)}px`;
            targetImg.style.height = `${Math.round(newH)}px`;
          }
        }
        if (resizeDir.includes('w')) {
          targetBox.style.left = `${Math.round(newLeft)}px`;
        }
        if (resizeDir.includes('n')) {
          targetBox.style.top = `${Math.round(newTop)}px`;
        }
      } else if (type === 'drag') {
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          interactionStateRef.current.hasMoved = true;
        }
        const nextLeft = initialLeft + deltaX;
        const nextTop = initialTop + deltaY;

        const { itemId, itemPage } = interactionStateRef.current;
        if (itemId && itemPage !== undefined) {
          updateItemOnPage(itemPage, itemId, { x: Math.round(nextLeft), y: Math.round(nextTop) }, false);
        } else {
          targetBox.style.left = `${Math.round(nextLeft)}px`;
          targetBox.style.top = `${Math.round(nextTop)}px`;
        }
      }
    };

    const handleEnd = (e) => {
      if (!interactionStateRef.current) return;
      const { type, targetBox, itemId, itemPage, startX, startY, initialLeft, initialTop, wasAlreadySelected, hasMoved } = interactionStateRef.current;
      
      if (type === 'drag' && !hasMoved && wasAlreadySelected) {
        interactionStateRef.current = null;
        if (itemId) {
          selectedImageElementRef.current = null;
          setSelectedImageId(null);
          setSelectedImageOpacity(null);
          if (targetBox && document.activeElement === targetBox) {
            targetBox.blur();
          }
        } else if (targetBox) {
          targetBox.classList.remove('is-selected');
          if (document.activeElement === targetBox) {
            targetBox.blur();
          }
          selectedImageElementRef.current = null;
          setSelectedImageId(null);
          setSelectedImageOpacity(null);
        }
        return;
      }

      if (type === 'drag' && targetBox && !itemId) {
        const currentClientX = e.changedTouches ? e.changedTouches[0].clientX : (e.clientX !== undefined ? e.clientX : startX);
        const currentClientY = e.changedTouches ? e.changedTouches[0].clientY : (e.clientY !== undefined ? e.clientY : startY);
        const finalLeft = initialLeft + (currentClientX - startX);
        const finalTop = initialTop + (currentClientY - startY);
        targetBox.style.left = `${Math.round(finalLeft)}px`;
        targetBox.style.top = `${Math.round(finalTop)}px`;
      }

      interactionStateRef.current = null;

      if (itemId && itemPage !== undefined && targetBox) {
        if (type === 'rotate') {
          const badge = targetBox.querySelector('.rotate-angle-badge');
          if (badge) badge.style.opacity = '0';
        }
        pushUndoSnapshot();
        return;
      }

      if (type === 'rotate' && targetBox) {
        const badge = targetBox.querySelector('.rotate-angle-badge');
        if (badge) badge.style.opacity = '0';
        if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
        if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
      } else if (type === 'resize' && targetBox) {
        if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
        if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
      } else if (type === 'drag' && targetBox) {
        if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
        if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
      }
    };

    window.addEventListener('mousemove', handleMove, { passive: true });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [currentLeftPage, currentRightPage, isCoverView]);

  // Editör İçindeki Öğelere Tıklama, Silme, Düzenleme, Kaydetme, Döndürme, Boyutlandırma ve Taşıma İşleyicisi
  const handleEditorMouseDownOrTouch = (e, editorRef, pageNum) => {
    if (penMode || selectedTapeImage) return;

    const layerBtn = e.target.closest('[data-agenda-layer]');
    if (layerBtn) {
      e.preventDefault();
      e.stopPropagation();
      const targetWrapper = layerBtn.closest('.agenda-block-wrapper');
      const dir = layerBtn.getAttribute('data-agenda-layer');
      if (targetWrapper && dir) {
        changeLayerOrder(dir, targetWrapper);
      }
      return;
    }

    const deleteBtn = e.target.closest('[data-agenda-delete="true"]');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const targetWrapper = deleteBtn.closest('.agenda-block-wrapper');
      if (targetWrapper) {
        if (activeTextBoxElementRef.current === targetWrapper) {
          activeTextBoxElementRef.current = null;
          savedSelectionRef.current = null;
          setActiveTextBoxId(null);
        }
        targetWrapper.remove();
        if (editorRef?.current && pageNum !== null) {
          saveContent(pageNum, editorRef.current.innerHTML);
        } else {
          if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
          if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
        }
      }
      return;
    }

    const saveImgBtn = e.target.closest('[data-agenda-save-image="true"]');
    if (saveImgBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrapperEl = saveImgBtn.closest('.agenda-image-wrapper');
      const imgEl = wrapperEl?.querySelector('img');
      if (wrapperEl && imgEl?.src) {
        const rect = wrapperEl.getBoundingClientRect();
        saveImageToGallery(imgEl.src, 'Kaydedilen Görsel', {
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
      return;
    }

    const editImgBtn = e.target.closest('[data-agenda-edit-image="true"]');
    if (editImgBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrapperEl = editImgBtn.closest('.agenda-image-wrapper');
      const imgEl = wrapperEl?.querySelector('img');
      if (wrapperEl && imgEl) {
        setBgRemovedPreviewSrc(null);
        setManualBrushMode(null);
        setCropAspect('free');
        setCropRect({ x: 0, y: 0, width: 100, height: 100 });
        setEditingImageModal({
          wrapperEl,
          imgEl,
          currentSrc: imgEl.src,
          originalSrc: imgEl.getAttribute('data-original-src') || imgEl.src
        });
      }
      return;
    }

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const rotateHandle = e.target.closest('.rotate-handle');
    if (rotateHandle) {
      e.preventDefault();
      e.stopPropagation();
      const targetBox = rotateHandle.closest('.agenda-block-wrapper');
      if (targetBox) {
        const rect = targetBox.getBoundingClientRect();
        interactionStateRef.current = {
          type: 'rotate',
          targetBox,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2
        };
      }
      return;
    }

    const resizeTarget = e.target.closest('.resize-handle, .resize-edge');
    if (resizeTarget) {
      e.preventDefault();
      e.stopPropagation();
      const targetBox = resizeTarget.closest('.agenda-block-wrapper');
      if (targetBox) {
        const contentEl = targetBox.querySelector('.agenda-textbox-content');
        const initialFontSize = contentEl
          ? parseFloat(contentEl.style.fontSize || window.getComputedStyle(contentEl).fontSize) || 15
          : 15;
        interactionStateRef.current = {
          type: 'resize',
          resizeDir: resizeTarget.getAttribute('data-resize-dir') || 'se',
          targetBox,
          startX: clientX,
          startY: clientY,
          initialWidth: targetBox.offsetWidth,
          initialHeight: targetBox.offsetHeight,
          initialLeft: targetBox.offsetLeft,
          initialTop: targetBox.offsetTop,
          initialFontSize
        };
      }
      return;
    }

    const imageWrapper = e.target.closest('.agenda-image-wrapper');
    if (imageWrapper) {
      if (imageWrapper.getAttribute('data-managed-item') === 'true') {
        return;
      }
      e.stopPropagation();
      const wasAlreadySelected = imageWrapper.classList.contains('is-selected');
      document.querySelectorAll('.agenda-image-wrapper.is-selected').forEach((el) => {
        if (el !== imageWrapper) el.classList.remove('is-selected');
      });
      document.querySelectorAll('.agenda-textbox-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));
      imageWrapper.classList.add('is-selected');
      selectedImageElementRef.current = imageWrapper;
      setSelectedImageId(null);
      const savedOp = parseInt(imageWrapper.getAttribute('data-opacity') || '100', 10);
      setSelectedImageOpacity(isNaN(savedOp) ? 100 : savedOp);
      setActiveTextBoxId(null);
      activeTextBoxElementRef.current = null;

      if (!e.target.closest('button') && !e.target.closest('.resize-handle') && !e.target.closest('.resize-edge') && !e.target.closest('.rotate-handle')) {
        e.preventDefault();
        interactionStateRef.current = {
          type: 'drag',
          targetBox: imageWrapper,
          startX: clientX,
          startY: clientY,
          initialLeft: imageWrapper.offsetLeft,
          initialTop: imageWrapper.offsetTop,
          wasAlreadySelected,
          hasMoved: false
        };
      }
      return;
    }

    const textBoxWrapper = e.target.closest('.agenda-textbox-wrapper');
    if (textBoxWrapper) {
      if (textBoxWrapper.getAttribute('data-managed-item') === 'true') {
        return;
      }
      e.stopPropagation();
    }
  };

  // Tam Kontrollü React Şekil, Metin Kutusu, Tablo ve Görsel Render Yardımcısı (Asla Silinmez, Takılmaz, Geri Atmaz)
  const renderManagedPageItems = (pageNum) => {
    const items = pageItems[pageNum] || [];
    if (items.length === 0) return null;

    return items.map((item) => {
      const isImageItem = item.itemType === 'image' || item.itemType === 'tape';
      const isSelected = isImageItem
        ? selectedImageId === item.id
        : activeTextBoxId === item.id;
      const isLocked = Boolean(item.locked);
      const isTable = item.itemType === 'table';
      const isPlainBox = ['default', 'sticky', 'oval', 'frame', 'rect', 'circle'].includes(item.shape);
      const isCentered = ['heart', 'star', 'hexagon', 'oval', 'circle', 'triangle', 'diamond', 'arrow', 'ribbon'].includes(item.shape);
      const opacityRatio = Math.max(0.1, Math.min(1, (item.opacity ?? 100) / 100));

      if (isImageItem) {
        return (
          <div
            key={item.id}
            id={item.id}
            data-managed-item="true"
            data-opacity={item.opacity ?? 100}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.target.closest('button') || e.target.closest('[data-item-control="true"]')) return;
              e.preventDefault();
              const wasAlreadySelected = selectedImageId === item.id;
              document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));
              setActiveTextBoxId(null);
              setActiveTableCell(null);
              activeTextBoxElementRef.current = null;
              selectedImageElementRef.current = { itemId: item.id, pageNum };
              setSelectedImageId(item.id);
              setSelectedImageOpacity(item.opacity ?? 100);
              if (isLocked) {
                if (wasAlreadySelected) {
                  selectedImageElementRef.current = null;
                  setSelectedImageId(null);
                  setSelectedImageOpacity(null);
                }
                return;
              }
              interactionStateRef.current = {
                type: 'drag',
                targetBox: e.currentTarget,
                itemId: item.id,
                itemPage: pageNum,
                startX: e.clientX,
                startY: e.clientY,
                initialLeft: item.x,
                initialTop: item.y,
                wasAlreadySelected,
                hasMoved: false
              };
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              if (e.target.closest('button') || e.target.closest('[data-item-control="true"]')) return;
              const wasAlreadySelected = selectedImageId === item.id;
              document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));
              setActiveTextBoxId(null);
              setActiveTableCell(null);
              activeTextBoxElementRef.current = null;
              selectedImageElementRef.current = { itemId: item.id, pageNum };
              setSelectedImageId(item.id);
              setSelectedImageOpacity(item.opacity ?? 100);
              if (isLocked) {
                if (wasAlreadySelected) {
                  selectedImageElementRef.current = null;
                  setSelectedImageId(null);
                  setSelectedImageOpacity(null);
                }
                return;
              }
              const t = e.touches[0];
              interactionStateRef.current = {
                type: 'drag',
                targetBox: e.currentTarget,
                itemId: item.id,
                itemPage: pageNum,
                startX: t.clientX,
                startY: t.clientY,
                initialLeft: item.x,
                initialTop: item.y,
                wasAlreadySelected,
                hasMoved: false
              };
            }}
            style={{
              position: 'absolute',
              left: `${item.x}px`,
              top: `${item.y}px`,
              width: `${item.width}px`,
              height: `${item.height}px`,
              borderRadius: '12px',
              zIndex: item.zIndex ?? (isSelected ? 36 : 33),
              cursor: isLocked ? 'default' : 'grab',
              userSelect: 'none',
              touchAction: 'none',
              transform: `rotate(${item.rotation || 0}deg)`,
              backgroundColor: 'transparent'
            }}
            className={`agenda-block-wrapper agenda-image-wrapper ${isSelected ? 'is-selected' : ''}`}
          >
            {/* 360° Döndürme Tutamacı */}
            {!isLocked && (
              <div
                data-item-control="true"
                className="rotate-handle"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.parentElement.getBoundingClientRect();
                  interactionStateRef.current = {
                    type: 'rotate',
                    targetBox: e.currentTarget.parentElement,
                    itemId: item.id,
                    itemPage: pageNum,
                    centerX: rect.left + rect.width / 2,
                    centerY: rect.top + rect.height / 2
                  };
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  updateItemOnPage(pageNum, item.id, { rotation: 0 }, true);
                }}
                title="360° Döndürmek için sürükleyin (Sıfırlamak için çift tıklayın)"
                style={{
                  position: 'absolute',
                  bottom: '-34px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '24px',
                  height: '24px',
                  zIndex: 55,
                  background: '#ffffff',
                  color: '#0284c7',
                  border: '2px solid #0284c7',
                  borderRadius: '9999px',
                  boxShadow: '0 3px 10px rgba(2, 132, 199, 0.28)',
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none',
                  touchAction: 'none'
                }}
              >
                <RotateCcw className="w-3 h-3 pointer-events-none" />
                <span
                  className="rotate-angle-badge"
                  style={{
                    position: 'absolute',
                    bottom: '-22px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    opacity: 0
                  }}
                >
                  {item.rotation || 0}°
                </span>
                <div
                  style={{
                    position: 'absolute',
                    top: '-10px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '2px',
                    height: '8px',
                    background: '#0284c7',
                    pointerEvents: 'none'
                  }}
                />
              </div>
            )}

            {/* Üst Kontrol Çubuğu */}
            <div
              data-item-control="true"
              className="drag-bar modern-drag-pill"
              onMouseDown={(e) => {
                if (e.target.closest('button')) return;
                e.preventDefault();
                e.stopPropagation();
                selectedImageElementRef.current = { itemId: item.id, pageNum };
                setSelectedImageId(item.id);
                setSelectedImageOpacity(item.opacity ?? 100);
                if (isLocked) return;
                interactionStateRef.current = {
                  type: 'drag',
                  targetBox: e.currentTarget.parentElement,
                  itemId: item.id,
                  itemPage: pageNum,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialLeft: item.x,
                  initialTop: item.y
                };
              }}
              onTouchStart={(e) => {
                if (e.target.closest('button')) return;
                e.stopPropagation();
                selectedImageElementRef.current = { itemId: item.id, pageNum };
                setSelectedImageId(item.id);
                setSelectedImageOpacity(item.opacity ?? 100);
                if (isLocked) return;
                const t = e.touches[0];
                interactionStateRef.current = {
                  type: 'drag',
                  targetBox: e.currentTarget.parentElement,
                  itemId: item.id,
                  itemPage: pageNum,
                  startX: t.clientX,
                  startY: t.clientY,
                  initialLeft: item.x,
                  initialTop: item.y
                };
              }}
              style={{
                position: 'absolute',
                top: '-38px',
                left: '50%',
                transform: 'translateX(-50%)',
                height: '32px',
                width: 'max-content',
                zIndex: 45,
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'nowrap',
                whiteSpace: 'nowrap',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.94)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(226, 232, 240, 0.95)',
                color: '#1e293b',
                padding: '0 6px 0 8px',
                cursor: isLocked ? 'default' : 'grab',
                borderRadius: '9999px',
                boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.18), 0 2px 6px -1px rgba(15, 23, 42, 0.08)',
                userSelect: 'none',
                touchAction: 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', pointerEvents: 'none', flexShrink: 0 }}>
                <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="text-slate-400 shrink-0">
                  <circle cx="3" cy="2.5" r="1.1" fill="currentColor" />
                  <circle cx="7" cy="2.5" r="1.1" fill="currentColor" />
                  <circle cx="3" cy="6" r="1.1" fill="currentColor" />
                  <circle cx="7" cy="6" r="1.1" fill="currentColor" />
                  <circle cx="3" cy="9.5" r="1.1" fill="currentColor" />
                  <circle cx="7" cy="9.5" r="1.1" fill="currentColor" />
                </svg>
                <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#334155', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                  {item.itemType === 'tape' ? 'Bant' : 'Görsel'}
                </span>
              </div>
              <div style={{ width: '1px', height: '14px', background: '#e2e8f0', flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: '2px', flexShrink: 0 }}>
                <button
                  type="button"
                  className="modern-bar-btn shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    duplicateItemOnPage(pageNum, item);
                  }}
                  title="Çoğalt (Kopyala)"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className={`modern-bar-btn shrink-0 ${isLocked ? 'is-locked' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleLockItemOnPage(pageNum, item);
                  }}
                  title={isLocked ? 'Kilidi Aç' : 'Sabitle / Kilitle'}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    {isLocked ? (
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    ) : (
                      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                    )}
                  </svg>
                </button>
                <button
                  type="button"
                  className="modern-bar-btn shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    changeLayerOrder('front', null, item.id, pageNum);
                  }}
                  title="Öne Al"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="modern-bar-btn shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    changeLayerOrder('back', null, item.id, pageNum);
                  }}
                  title="Arkaya Al"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {item.itemType === 'image' && (
                  <>
                    <button
                      type="button"
                      className="modern-bar-btn shrink-0 text-emerald-600"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        saveImageToGallery(item.src, 'Kaydedilen Görsel', {
                          width: item.width,
                          height: item.height
                        });
                      }}
                      title="Galeriye Kaydet"
                    >
                      <FolderHeart className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="modern-bar-btn shrink-0 text-sky-600"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setBgRemovedPreviewSrc(null);
                        setManualBrushMode(null);
                        setCropAspect('free');
                        setCropRect({ x: 0, y: 0, width: 100, height: 100 });
                        setEditingImageModal({
                          itemId: item.id,
                          pageNum,
                          currentSrc: item.src,
                          originalSrc: item.originalSrc || item.src
                        });
                      }}
                      title="Kırp / Düzenle"
                    >
                      <Crop className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {!isLocked && (
                  <button
                    type="button"
                    className="modern-close-btn shrink-0"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeItemFromPage(pageNum, item.id);
                      if (selectedImageElementRef.current?.itemId === item.id || selectedImageId === item.id) {
                        selectedImageElementRef.current = null;
                        setSelectedImageId(null);
                        setSelectedImageOpacity(null);
                      }
                    }}
                    title="Sil"
                  >
                    <X className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                )}
              </div>
            </div>

            {/* Görsel veya Bant İçeriği */}
            {item.itemType === 'tape' ? (
              <div
                className="tape-freehand-strip"
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  opacity: opacityRatio,
                  pointerEvents: 'none'
                }}
                dangerouslySetInnerHTML={{ __html: item.stampsHtml || '' }}
              />
            ) : (
              <img
                src={item.src}
                alt="Ajanda Görseli"
                draggable="false"
                className="agenda-image-target"
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  borderRadius: '10px',
                  objectFit: 'fill',
                  pointerEvents: 'none',
                  opacity: opacityRatio
                }}
              />
            )}

            {/* Kenar ve Köşe Boyutlandırma Tutamaçları */}
            {!isLocked && ['n', 's', 'w', 'e'].map((dir) => (
              <div
                key={dir}
                data-item-control="true"
                data-resize-dir={dir}
                className={`resize-edge resize-edge-${dir}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  interactionStateRef.current = {
                    type: 'resize',
                    resizeDir: dir,
                    targetBox: e.currentTarget.parentElement,
                    itemId: item.id,
                    itemPage: pageNum,
                    startX: e.clientX,
                    startY: e.clientY,
                    initialWidth: item.width,
                    initialHeight: item.height,
                    initialLeft: item.x,
                    initialTop: item.y
                  };
                }}
              />
            ))}
            {!isLocked && [
              { dir: 'nw', style: { left: '-6px', top: '-6px', cursor: 'nw-resize', background: '#ffffff', border: '2px solid #0284c7' } },
              { dir: 'ne', style: { right: '-6px', top: '-6px', cursor: 'ne-resize', background: '#ffffff', border: '2px solid #0284c7' } },
              { dir: 'sw', style: { left: '-6px', bottom: '-6px', cursor: 'sw-resize', background: '#ffffff', border: '2px solid #0284c7' } },
              { dir: 'se', style: { right: '-6px', bottom: '-6px', cursor: 'se-resize', background: '#0284c7', border: '2px solid #ffffff' } }
            ].map((corner) => (
              <div
                key={corner.dir}
                data-item-control="true"
                data-resize-dir={corner.dir}
                className={`resize-handle resize-corner-${corner.dir}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  interactionStateRef.current = {
                    type: 'resize',
                    resizeDir: corner.dir,
                    targetBox: e.currentTarget.parentElement,
                    itemId: item.id,
                    itemPage: pageNum,
                    startX: e.clientX,
                    startY: e.clientY,
                    initialWidth: item.width,
                    initialHeight: item.height,
                    initialLeft: item.x,
                    initialTop: item.y
                  };
                }}
                style={{
                  position: 'absolute',
                  width: '14px',
                  height: '14px',
                  zIndex: 46,
                  borderRadius: '50%',
                  boxShadow: '0 2px 5px rgba(2, 132, 199, 0.35)',
                  userSelect: 'none',
                  touchAction: 'none',
                  ...corner.style
                }}
              />
            ))}
          </div>
        );
      }

      return (
        <div
          key={item.id}
          id={item.id}
          tabIndex={0}
          data-managed-item="true"
          data-box-shape={item.shape}
          data-box-bg={item.bgColor}
          data-opacity={item.opacity ?? 100}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (e.target.closest('[data-item-control="true"]')) return;
            document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));
            activeTextBoxElementRef.current = e.currentTarget;
            selectedImageElementRef.current = null;
            setSelectedImageId(null);
            setSelectedImageOpacity(null);
            setActiveTextBoxId(item.id);
            setCurrentBoxBgColor(item.bgColor || 'transparent');
            setCurrentBoxShape(item.shape || 'default');
            setCurrentBoxOpacity(item.opacity ?? 100);
            setCurrentFontFamily(item.fontFamily || "'Inter', sans-serif");
            setCurrentFontSize(item.fontSize || '15px');
            setCurrentTextColor(item.textColor || '#1e293b');
            setCurrentLineHeight(item.lineHeight || '1.5');
            requestAnimationFrame(() => syncToolbarStates());
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            if (e.target.closest('[data-item-control="true"]')) return;
            activeTextBoxElementRef.current = e.currentTarget;
            selectedImageElementRef.current = null;
            setSelectedImageId(null);
            setSelectedImageOpacity(null);
            setActiveTextBoxId(item.id);
            setCurrentBoxBgColor(item.bgColor || 'transparent');
            setCurrentBoxShape(item.shape || 'default');
            setCurrentBoxOpacity(item.opacity ?? 100);
            setCurrentFontFamily(item.fontFamily || "'Inter', sans-serif");
            setCurrentFontSize(item.fontSize || '15px');
            setCurrentTextColor(item.textColor || '#1e293b');
            setCurrentLineHeight(item.lineHeight || '1.5');
            requestAnimationFrame(() => syncToolbarStates());
          }}
          style={{
            position: 'absolute',
            left: `${item.x}px`,
            top: `${item.y}px`,
            width: `${item.width}px`,
            height: item.height ? `${item.height}px` : 'auto',
            minHeight: isTable ? '64px' : isCentered ? `${item.height || 140}px` : '80px',
            zIndex: item.zIndex ?? (isSelected ? 36 : 34),
            transform: `rotate(${item.rotation || 0}deg)`,
            '--box-bg': (() => {
              const raw = (item.bgColor || 'transparent').trim();
              if (!raw || raw === 'transparent') return 'transparent';
              if (raw.startsWith('#')) {
                let hex = raw.slice(1);
                if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
                if (hex.length >= 6) {
                  const r = parseInt(hex.slice(0, 2), 16);
                  const g = parseInt(hex.slice(2, 4), 16);
                  const b = parseInt(hex.slice(4, 6), 16);
                  return `rgba(${r}, ${g}, ${b}, ${opacityRatio.toFixed(2)})`;
                }
              }
              const rgbMatch = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
              if (rgbMatch) {
                return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacityRatio.toFixed(2)})`;
              }
              return raw;
            })(),
            backgroundColor: isPlainBox ? 'var(--box-bg)' : 'transparent',
            opacity: 1
          }}
          className={`agenda-block-wrapper agenda-textbox-wrapper ${isSelected ? 'is-selected' : ''}`}
        >
          {/* 360° Döndürme Tutamacı (Kutunun Altında) */}
          {!isLocked && (
            <div
              data-item-control="true"
              className="rotate-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.parentElement.getBoundingClientRect();
                interactionStateRef.current = {
                  type: 'rotate',
                  targetBox: e.currentTarget.parentElement,
                  itemId: item.id,
                  itemPage: pageNum,
                  centerX: rect.left + rect.width / 2,
                  centerY: rect.top + rect.height / 2
                };
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                updateItemOnPage(pageNum, item.id, { rotation: 0 }, true);
              }}
              title="360° Döndürmek için sürükleyin (Sıfırlamak için çift tıklayın)"
              style={{
                position: 'absolute',
                bottom: '-34px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '24px',
                height: '24px',
                zIndex: 55,
                background: '#ffffff',
                color: '#0284c7',
                border: '2px solid #0284c7',
                borderRadius: '9999px',
                boxShadow: '0 3px 10px rgba(2, 132, 199, 0.28)',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                touchAction: 'none'
              }}
            >
              <RotateCcw className="w-3 h-3 pointer-events-none" />
              <span
                className="rotate-angle-badge"
                style={{
                  position: 'absolute',
                  bottom: '-22px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#0f172a',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: '6px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  opacity: 0
                }}
              >
                {item.rotation || 0}°
              </span>
              <div
                style={{
                  position: 'absolute',
                  top: '-10px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '2px',
                  height: '8px',
                  background: '#0284c7',
                  pointerEvents: 'none'
                }}
              />
            </div>
          )}

          {/* Üst Taşıma Çubuğu ve Modern İkon Menüsü */}
          <div
            data-item-control="true"
            className="drag-bar modern-drag-pill"
            onMouseDown={(e) => {
              if (e.target.closest('button')) return;
              e.preventDefault();
              e.stopPropagation();
              if (isLocked) return;
              interactionStateRef.current = {
                type: 'drag',
                targetBox: e.currentTarget.parentElement,
                itemId: item.id,
                itemPage: pageNum,
                startX: e.clientX,
                startY: e.clientY,
                initialLeft: item.x,
                initialTop: item.y
              };
            }}
            onTouchStart={(e) => {
              if (e.target.closest('button')) return;
              e.stopPropagation();
              if (isLocked) return;
              const t = e.touches[0];
              interactionStateRef.current = {
                type: 'drag',
                targetBox: e.currentTarget.parentElement,
                itemId: item.id,
                itemPage: pageNum,
                startX: t.clientX,
                startY: t.clientY,
                initialLeft: item.x,
                initialTop: item.y
              };
            }}
            style={{
              position: 'absolute',
              top: '-38px',
              left: '50%',
              transform: 'translateX(-50%)',
              height: '32px',
              width: 'max-content',
              zIndex: 45,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(226, 232, 240, 0.95)',
              color: '#1e293b',
              padding: '0 6px 0 8px',
              cursor: isLocked ? 'default' : 'grab',
              borderRadius: '9999px',
              boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.18), 0 2px 6px -1px rgba(15, 23, 42, 0.08)',
              userSelect: 'none',
              touchAction: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', pointerEvents: 'none' }}>
              <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="text-slate-400 shrink-0">
                <circle cx="3" cy="2.5" r="1.1" fill="currentColor" />
                <circle cx="7" cy="2.5" r="1.1" fill="currentColor" />
                <circle cx="3" cy="6" r="1.1" fill="currentColor" />
                <circle cx="7" cy="6" r="1.1" fill="currentColor" />
                <circle cx="3" cy="9.5" r="1.1" fill="currentColor" />
                <circle cx="7" cy="9.5" r="1.1" fill="currentColor" />
              </svg>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#334155', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                {isTable ? 'Tablo' : item.shape === 'default' ? 'Metin' : 'Şekil'}
              </span>
            </div>
            <div style={{ width: '1px', height: '14px', background: '#e2e8f0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <button
                type="button"
                className="modern-bar-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  duplicateItemOnPage(pageNum, item);
                }}
                title="Çoğalt (Kopyala)"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className={`modern-bar-btn ${isLocked ? 'is-locked' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleLockItemOnPage(pageNum, item);
                }}
                title={isLocked ? 'Kilidi Aç' : 'Sabitle / Kilitle'}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  {isLocked ? (
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  ) : (
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  )}
                </svg>
              </button>
              <button
                type="button"
                className="modern-bar-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  changeLayerOrder('front', null, item.id, pageNum);
                }}
                title="Öne Al"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                className="modern-bar-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  changeLayerOrder('back', null, item.id, pageNum);
                }}
                title="Arkaya Al"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {!isLocked && (
                <button
                  type="button"
                  className="modern-close-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeItemFromPage(pageNum, item.id);
                  }}
                  title="Sil"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>

          {/* Tablo veya Şekil / Metin Kutusu İçerik Alanı */}
          {isTable ? (
            <div
              className="agenda-textbox-content w-full h-full overflow-hidden rounded-[10px]"
              style={{
                padding: '2px',
                fontFamily: item.fontFamily || "'Inter', sans-serif",
                fontSize: item.fontSize || '13px',
                lineHeight: item.lineHeight || '1.35',
                color: item.textColor || '#1e293b'
              }}
            >
              <table
                style={{
                  width: '100%',
                  height: '100%',
                  borderCollapse: 'collapse',
                  tableLayout: 'fixed'
                }}
              >
                <tbody>
                  {Array.from({ length: item.rows || 3 }, (_, rIdx) => {
                    const isHeaderRow = item.hasHeader && rIdx === 0;
                    return (
                      <tr
                        key={rIdx}
                        style={{
                          backgroundColor: isHeaderRow
                            ? `rgba(226, 232, 240, ${(0.88 * opacityRatio).toFixed(2)})`
                            : 'transparent'
                        }}
                      >
                        {Array.from({ length: item.cols || 3 }, (_, cIdx) => {
                          const cellHtml = item.cells?.[rIdx]?.[cIdx] ?? '';
                          const cellKey = `${rIdx}_${cIdx}`;
                          const customCellColor = item.cellColors?.[cellKey];
                          const isCellSelected =
                            isSelected &&
                            activeTableCell?.boxId === item.id &&
                            activeTableCell?.row === rIdx &&
                            activeTableCell?.col === cIdx;

                          const resolvedCellBg = (() => {
                            if (!customCellColor || customCellColor === 'transparent') return undefined;
                            const raw = customCellColor.trim();
                            if (raw.startsWith('#')) {
                              let hex = raw.slice(1);
                              if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
                              if (hex.length >= 6) {
                                const r = parseInt(hex.slice(0, 2), 16);
                                const g = parseInt(hex.slice(2, 4), 16);
                                const b = parseInt(hex.slice(4, 6), 16);
                                return `rgba(${r}, ${g}, ${b}, ${opacityRatio.toFixed(2)})`;
                              }
                            }
                            return raw;
                          })();

                          return (
                            <td
                              key={cIdx}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setActiveTextBoxId(item.id);
                                setActiveTableCell({ boxId: item.id, row: rIdx, col: cIdx });
                                setCurrentBoxBgColor(customCellColor || item.bgColor || '#ffffff');
                                setCurrentBoxOpacity(item.opacity ?? 100);
                              }}
                              onTouchStart={(e) => {
                                e.stopPropagation();
                                setActiveTextBoxId(item.id);
                                setActiveTableCell({ boxId: item.id, row: rIdx, col: cIdx });
                                setCurrentBoxBgColor(customCellColor || item.bgColor || '#ffffff');
                                setCurrentBoxOpacity(item.opacity ?? 100);
                              }}
                              style={{
                                border: `1px solid rgba(100, 116, 139, ${Math.max(0.28, 0.72 * opacityRatio).toFixed(2)})`,
                                padding: '5px 7px',
                                verticalAlign: 'top',
                                fontWeight: isHeaderRow ? 700 : 400,
                                textAlign: item.textAlign || 'left',
                                wordBreak: 'break-word',
                                backgroundColor: resolvedCellBg,
                                boxShadow: isCellSelected ? 'inset 0 0 0 2px #0284c7' : undefined
                              }}
                            >
                              <div
                                contentEditable={!isLocked}
                                suppressContentEditableWarning
                                data-placeholder={isHeaderRow ? `Başlık ${cIdx + 1}` : ''}
                                ref={(el) => {
                                  if (el && document.activeElement !== el && el.innerHTML !== cellHtml) {
                                    el.innerHTML = cellHtml;
                                  }
                                }}
                                onFocus={() => {
                                  setActiveTextBoxId(item.id);
                                  setActiveTableCell({ boxId: item.id, row: rIdx, col: cIdx });
                                  setCurrentBoxBgColor(customCellColor || item.bgColor || '#ffffff');
                                }}
                                onInput={(e) => {
                                  updateTableCellText(pageNum, item, rIdx, cIdx, e.currentTarget.innerHTML, false);
                                }}
                                onBlur={(e) => {
                                  updateTableCellText(pageNum, item, rIdx, cIdx, e.currentTarget.innerHTML, true);
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                }}
                                style={{
                                  outline: 'none',
                                  minHeight: '20px',
                                  width: '100%',
                                  height: '100%'
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              className="agenda-textbox-content"
              contentEditable={!isLocked}
              suppressContentEditableWarning
              data-placeholder={item.shape === 'default' ? 'Buraya yazın...' : ''}
              ref={(el) => {
                if (el && document.activeElement !== el && el.innerHTML !== (item.html || '')) {
                  el.innerHTML = item.html || '';
                }
              }}
              onInput={(e) => {
                updateItemOnPage(pageNum, item.id, { html: e.currentTarget.innerHTML }, false);
              }}
              onBlur={(e) => {
                updateItemOnPage(pageNum, item.id, { html: e.currentTarget.innerHTML }, true);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
              }}
              style={{
                width: '100%',
                height: '100%',
                minHeight: 'inherit',
                padding: '10px 12px',
                outline: 'none',
                fontFamily: item.fontFamily || "'Inter', sans-serif",
                fontSize: item.fontSize || '15px',
                lineHeight: item.lineHeight || '1.5',
                color: item.textColor || '#1e293b',
                textAlign: item.textAlign || (isCentered ? 'center' : 'left'),
                backgroundColor: !isPlainBox ? 'var(--box-bg)' : 'transparent',
                opacity: opacityRatio
              }}
            />
          )}

          {/* Kenar ve Köşe Boyutlandırma Tutamaçları */}
          {!isLocked && ['n', 's', 'w', 'e'].map((dir) => (
            <div
              key={dir}
              data-item-control="true"
              data-resize-dir={dir}
              className={`resize-edge resize-edge-${dir}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                interactionStateRef.current = {
                  type: 'resize',
                  resizeDir: dir,
                  targetBox: e.currentTarget.parentElement,
                  itemId: item.id,
                  itemPage: pageNum,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialWidth: item.width,
                  initialHeight: item.height || e.currentTarget.parentElement.offsetHeight,
                  initialLeft: item.x,
                  initialTop: item.y,
                  initialFontSize: parseFloat(item.fontSize || '15') || 15
                };
              }}
            />
          ))}
          {!isLocked && [
            { dir: 'nw', style: { left: '-6px', top: '-6px', cursor: 'nw-resize', background: '#ffffff', border: '2px solid #0284c7' } },
            { dir: 'ne', style: { right: '-6px', top: '-6px', cursor: 'ne-resize', background: '#ffffff', border: '2px solid #0284c7' } },
            { dir: 'sw', style: { left: '-6px', bottom: '-6px', cursor: 'sw-resize', background: '#ffffff', border: '2px solid #0284c7' } },
            { dir: 'se', style: { right: '-6px', bottom: '-6px', cursor: 'se-resize', background: '#0284c7', border: '2px solid #ffffff' } }
          ].map((corner) => (
            <div
              key={corner.dir}
              data-item-control="true"
              data-resize-dir={corner.dir}
              className={`resize-handle resize-corner-${corner.dir}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                interactionStateRef.current = {
                  type: 'resize',
                  resizeDir: corner.dir,
                  targetBox: e.currentTarget.parentElement,
                  itemId: item.id,
                  itemPage: pageNum,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialWidth: item.width,
                  initialHeight: item.height || e.currentTarget.parentElement.offsetHeight,
                  initialLeft: item.x,
                  initialTop: item.y,
                  initialFontSize: parseFloat(item.fontSize || '15') || 15
                };
              }}
              style={{
                position: 'absolute',
                width: '14px',
                height: '14px',
                zIndex: 46,
                borderRadius: '50%',
                boxShadow: '0 2px 5px rgba(2, 132, 199, 0.35)',
                userSelect: 'none',
                touchAction: 'none',
                ...corner.style
              }}
            />
          ))}
        </div>
      );
    });
  };

  // Tüm Ajandayı İndir (Kapak ve Tüm Sayfalar Birebir A5 Defter Görünümüyle)
  const exportNotebook = () => {
    const filledPages = [];
    for (let i = 0; i <= TOTAL_PAGES; i++) {
      const hasContent = pagesContent[i] && pagesContent[i].replace(/<[^>]*>/g, '').trim() !== '' || (pagesContent[i] && /<(img|div|svg)/i.test(pagesContent[i]));
      const hasItems = (pageItems[i] || []).length > 0;
      const hasBgColor = pageBgColors[i] && pageBgColors[i] !== (i === 0 ? '#f5efe6' : '#fdfbf7');
      const hasBgImage = Boolean(pageBgImages[i]);
      const hasRuling = pageRulings[i] && pageRulings[i] !== 'plain';
      const hasDrawing = Boolean(pageDrawings[i]);

      if (i === 0 || hasContent || hasItems || hasBgColor || hasBgImage || hasRuling || hasDrawing) {
        filledPages.push(i);
      }
    }

    const pagesHtml = filledPages
      .map((pageNum) => {
        const isCover = pageNum === 0;
        const bgColor = pageBgColors[pageNum] || (isCover ? '#f5efe6' : '#fdfbf7');
        const bgImg = pageBgImages[pageNum];
        const ruling = pageRulings[pageNum] || 'plain';
        const drawingSrc = pageDrawings[pageNum];
        const rawHtml = pagesContent[pageNum] || '';
        const itemsHtml = (pageItems[pageNum] || [])
          .map((it) => {
            const op = ((it.opacity ?? 100) / 100).toFixed(2);
            if (it.itemType === 'image') {
              return `<div class="agenda-image-wrapper" style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.width}px;height:${it.height}px;transform:rotate(${it.rotation || 0}deg);"><img src="${it.src}" style="width:100%;height:100%;display:block;border-radius:10px;object-fit:fill;opacity:${op};" /></div>`;
            }
            if (it.itemType === 'tape') {
              return `<div class="agenda-image-wrapper" style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.width}px;height:${it.height}px;transform:rotate(${it.rotation || 0}deg);opacity:${op};">${it.stampsHtml || ''}</div>`;
            }
            const isPlain = ['default', 'sticky', 'oval', 'frame', 'rect', 'circle'].includes(it.shape);
            if (it.itemType === 'table') {
              const rowsCount = it.rows || 3;
              const colsCount = it.cols || 3;
              const rowsHtml = Array.from({ length: rowsCount }, (_, r) => {
                const isHdr = it.hasHeader && r === 0;
                const tds = Array.from({ length: colsCount }, (__, c) => {
                  const val = it.cells?.[r]?.[c] ?? '';
                  return `<td style="border:1px solid #64748b;padding:5px 7px;vertical-align:top;font-weight:${isHdr ? 700 : 400};text-align:${it.textAlign || 'left'};">${val}</td>`;
                }).join('');
                return `<tr style="background-color:${isHdr ? '#e2e8f0' : 'transparent'};">${tds}</tr>`;
              }).join('');
              return `<div class="agenda-textbox-wrapper" style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.width}px;height:${it.height ? it.height + 'px' : 'auto'};transform:rotate(${it.rotation || 0}deg);opacity:${op};background-color:${it.bgColor || '#ffffff'};"><table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-family:${it.fontFamily || "'Inter', sans-serif"};font-size:${it.fontSize || '13px'};color:${it.textColor || '#1e293b'};"><tbody>${rowsHtml}</tbody></table></div>`;
            }
            return `<div class="agenda-textbox-wrapper" data-box-shape="${it.shape}" style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.width}px;height:${it.height ? it.height + 'px' : 'auto'};transform:rotate(${it.rotation || 0}deg);opacity:${op};--box-bg:${it.bgColor || 'transparent'};background-color:${isPlain ? (it.bgColor || 'transparent') : 'transparent'};"><div class="agenda-textbox-content" style="width:100%;height:100%;padding:10px 12px;font-family:${it.fontFamily || "'Inter', sans-serif"};font-size:${it.fontSize || '15px'};line-height:${it.lineHeight || '1.5'};color:${it.textColor || '#1e293b'};text-align:${it.textAlign || 'left'};background-color:${!isPlain ? (it.bgColor || 'transparent') : 'transparent'};">${it.html || ''}</div></div>`;
          })
          .join('');

        const rulingClass = bgImg
          ? ''
          : ruling === 'lined'
          ? 'notebook-page-lined'
          : ruling === 'grid'
          ? 'notebook-page-grid'
          : 'notebook-page-surface';

        const bgStyle = bgImg
          ? `background-color: ${bgColor}; background-image: url('${bgImg}'); background-size: cover; background-position: center; background-repeat: no-repeat;`
          : `background-color: ${bgColor};`;

        return `
          <div class="a5-page-wrapper">
            <div class="a5-page-label">${isCover ? 'Kapak Sayfası (0)' : `Sayfa ${pageNum}`}</div>
            <section class="a5-sheet ${rulingClass} ${isCover ? 'is-cover' : ''}" style="${bgStyle}">
              <div class="a5-content">${rawHtml}${itemsHtml}</div>
              ${drawingSrc ? `<img src="${drawingSrc}" alt="Sayfa ${pageNum} Çizimi" class="a5-drawing-layer" />` : ''}
              ${!isCover ? `<span class="a5-page-num">${pageNum}</span>` : ''}
            </section>
          </div>
        `;
      })
      .join('\n');

    const fullDoc = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>A5 Ajandam (Tam Kitap)</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Alex+Brush&family=Allura&family=Amatic+SC:wght@700&family=Anton&family=Architects+Daughter&family=Audiowide&family=Bangers&family=Bebas+Neue&family=Black+Ops+One&family=Bungee&family=Caveat:wght@600;700&family=Cinzel+Decorative:wght@700&family=Comfortaa:wght@500;700&family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Creepster&family=Dancing+Script:wght@700&family=Fredoka:wght@500;700&family=Gloria+Hallelujah&family=Great+Vibes&family=Homemade+Apple&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;700&family=Lobster&family=Luckiest+Guy&family=Monoton&family=Orbitron:wght@500;700&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:ital,wght@0,600;0,800;1,600&family=Press+Start+2P&family=Righteous&family=Rock+Salt&family=Russo+One&family=Sacramento&family=Satisfy&family=Shadows+Into+Light&family=Special+Elite&family=Syne:wght@600;800&family=UnifrakturMaguntia&display=swap" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 16px 64px;
      background: #4e3219;
      background-image: radial-gradient(circle at 30% 20%, rgba(255,244,214,0.22), rgba(28,15,5,0.65));
      font-family: 'Inter', sans-serif;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 36px;
    }
    .export-toolbar {
      position: sticky;
      top: 16px;
      z-index: 100;
      background: rgba(15, 23, 42, 0.92);
      color: #fff;
      padding: 10px 18px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.35);
      font-size: 13px;
    }
    .export-toolbar button {
      background: #0284c7;
      color: #fff;
      border: none;
      border-radius: 9999px;
      padding: 6px 14px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
    }
    .a5-page-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .a5-page-label {
      color: #fef3c7;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .a5-sheet {
      position: relative;
      width: 148mm;
      height: 210mm;
      min-width: 480px;
      min-height: 680px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 22px 45px rgba(15, 10, 5, 0.55), 0 0 0 1px rgba(15, 23, 42, 0.15);
    }
    .a5-sheet.is-cover::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 28px;
      background: linear-gradient(to right, rgba(15,23,42,0.22), rgba(15,23,42,0.06) 40%, transparent);
      pointer-events: none;
      z-index: 5;
    }
    .notebook-page-surface {
      background-image: radial-gradient(rgba(15, 23, 42, 0.022) 1px, transparent 0);
      background-size: 18px 18px;
    }
    .notebook-page-lined {
      background-image:
        linear-gradient(90deg, transparent 42px, rgba(239, 68, 68, 0.22) 42px, rgba(239, 68, 68, 0.22) 43.5px, transparent 43.5px),
        repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, rgba(59, 130, 246, 0.22) 31px, rgba(59, 130, 246, 0.22) 32px);
      background-size: 100% 100%, 100% 32px;
      background-position: 0 0, 0 38px;
    }
    .notebook-page-grid {
      background-image:
        linear-gradient(to right, rgba(59, 130, 246, 0.18) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(59, 130, 246, 0.18) 1px, transparent 1px);
      background-size: 24px 24px;
      background-position: 24px 24px;
    }
    .a5-content {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 40px 44px 48px;
      font-size: 15px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .a5-drawing-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 25;
    }
    .a5-page-num {
      position: absolute;
      bottom: 16px;
      right: 28px;
      font-size: 11px;
      font-weight: 600;
      color: rgba(71, 85, 105, 0.8);
      z-index: 30;
    }
    /* Düzenleme tutamaçlarını indirilen kitapta gizle */
    .drag-bar, .rotate-handle, .resize-handle, .resize-edge {
      display: none !important;
    }
    .agenda-textbox-wrapper, .agenda-image-wrapper {
      border: none !important;
      box-shadow: none !important;
    }
    .agenda-textbox-content {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .agenda-textbox-wrapper[data-box-shape="sticky"] {
      background-color: var(--box-bg, #fef08a) !important;
      border-radius: 2px 2px 24px 2px !important;
      box-shadow: 0 10px 20px -5px rgba(15, 23, 42, 0.14) !important;
    }
    .agenda-textbox-wrapper[data-box-shape="heart"] .agenda-textbox-content {
      clip-path: polygon(50% 21%, 54% 15%, 59% 10%, 65% 6%, 71% 5%, 78% 6%, 84% 9%, 90% 14%, 94% 21%, 97% 29%, 97% 37%, 95% 46%, 91% 54%, 85% 63%, 77% 72%, 68% 81%, 59% 89%, 50% 96%, 41% 89%, 32% 81%, 23% 72%, 15% 63%, 9% 54%, 5% 46%, 3% 37%, 3% 29%, 6% 21%, 10% 14%, 16% 9%, 22% 6%, 29% 5%, 35% 6%, 41% 10%, 46% 15%);
      background-color: var(--box-bg, #ffe4e6) !important;
      padding: 28px 26px 30px !important;
      text-align: center;
    }
    .agenda-textbox-wrapper[data-box-shape="bubble"] .agenda-textbox-content {
      clip-path: polygon(0% 0%, 100% 0%, 100% 80%, 34% 80%, 16% 100%, 20% 80%, 0% 80%);
      background-color: var(--box-bg, #e0f2fe) !important;
      border-radius: 16px;
      padding: 12px 14px 26px !important;
    }
    .agenda-textbox-wrapper[data-box-shape="star"] .agenda-textbox-content {
      clip-path: polygon(50% 0%, 63% 32%, 98% 35%, 71% 58%, 79% 92%, 50% 73%, 21% 92%, 29% 58%, 2% 35%, 37% 32%);
      background-color: var(--box-bg, #fef3c7) !important;
      padding: 34px 28px 24px !important;
      text-align: center;
    }
    .agenda-textbox-wrapper[data-box-shape="hexagon"] .agenda-textbox-content {
      clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
      background-color: var(--box-bg, #f3e8ff) !important;
      padding: 22px 28px !important;
      text-align: center;
    }
    .agenda-textbox-wrapper[data-box-shape="oval"], .agenda-textbox-wrapper[data-box-shape="circle"] {
      border-radius: 9999px !important;
    }
    .agenda-textbox-wrapper[data-box-shape="triangle"] .agenda-textbox-content {
      clip-path: polygon(50% 4%, 98% 96%, 2% 96%);
      background-color: var(--box-bg, #fde047) !important;
      padding: 42px 24px 16px !important;
      text-align: center;
    }
    .agenda-textbox-wrapper[data-box-shape="diamond"] .agenda-textbox-content {
      clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
      background-color: var(--box-bg, #ddd6fe) !important;
      padding: 26px !important;
      text-align: center;
    }
    .agenda-textbox-wrapper[data-box-shape="arrow"] .agenda-textbox-content {
      clip-path: polygon(0% 24%, 64% 24%, 64% 4%, 100% 50%, 64% 96%, 64% 76%, 0% 76%);
      background-color: var(--box-bg, #bbf7d0) !important;
      padding: 18px 42px 18px 16px !important;
      text-align: center;
    }
    @media print {
      body { background: #fff; padding: 0; gap: 0; }
      .export-toolbar, .a5-page-label { display: none !important; }
      .a5-page-wrapper { page-break-after: always; break-after: page; }
      .a5-sheet { box-shadow: none; border-radius: 0; width: 148mm; height: 210mm; }
    }
  </style>
</head>
<body>
  <div class="export-toolbar">
    <span><strong>A5 Ajandam</strong> (${filledPages.length} sayfa)</span>
    <button type="button" onclick="window.print()">PDF Olarak Kaydet / Yazdır</button>
  </div>
  ${pagesHtml}
</body>
</html>`;

    const blob = new Blob([fullDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'A5-Ajandam-Tam-Kitap.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Ahşap masa yüzeyine (ajanda ve panellerin dışındaki alana) tıklandığında üst ve alt araç çubuklarını aç/kapat
  const handleBackgroundClick = (e) => {
    if (!e.target.closest('.agenda-block-wrapper') && !e.target.closest('#image-opacity-toolbar')) {
      document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));
      if (document.activeElement && document.activeElement.closest?.('.agenda-block-wrapper')) {
        (document.activeElement as HTMLElement).blur();
      }
      activeTextBoxElementRef.current = null;
      selectedImageElementRef.current = null;
      savedSelectionRef.current = null;
      setActiveTextBoxId(null);
      setActiveTableCell(null);
      setSelectedImageId(null);
      setSelectedImageOpacity(null);
      setFontMenuOpen(false);
      setColorPaletteOpen(false);
      setBgPaletteOpen(false);
    }
    if (!e.target.closest('[data-desk-item="true"]')) {
      setSelectedDeskItemId(null);
    }
    if (
      e.target.closest('#agenda-book') ||
      e.target.closest('#agenda-ruler') ||
      e.target.closest('[data-desk-item="true"]') ||
      e.target.closest('header') ||
      e.target.closest('footer') ||
      e.target.closest('aside') ||
      e.target.closest('#saved-images-gallery') ||
      e.target.closest('#image-editor-modal') ||
      e.target.closest('#cloud-sync-modal') ||
      e.target.closest('#textbox-format-toolbar') ||
      e.target.closest('#image-opacity-toolbar') ||
      e.target.closest('button')
    ) {
      return;
    }
    setPageBgPaletteOpen(false);
    setShapeMenuOpen(false);
    setTableMenuOpen(false);
    setGalleryOpen(false);
    setPanelsVisible((prev) => !prev);
  };

  // Sayfa içindeki boş alana tıklandığında (metin kutusu, resim veya dolu yazı satırı değilse) araç çubuklarını aç/kapat
  const handlePageEmptyAreaClick = (e) => {
    if (!e.target.closest('.agenda-block-wrapper') && !e.target.closest('#image-opacity-toolbar')) {
      document.querySelectorAll('.agenda-block-wrapper.is-selected').forEach((el) => el.classList.remove('is-selected'));
      if (document.activeElement && document.activeElement.closest?.('.agenda-block-wrapper')) {
        (document.activeElement as HTMLElement).blur();
      }
      activeTextBoxElementRef.current = null;
      selectedImageElementRef.current = null;
      savedSelectionRef.current = null;
      setActiveTextBoxId(null);
      setSelectedImageId(null);
      setSelectedImageOpacity(null);
      setFontMenuOpen(false);
      setColorPaletteOpen(false);
      setBgPaletteOpen(false);
    }
    if (
      e.target.closest('.agenda-block-wrapper') ||
      e.target.closest('button') ||
      e.target.closest('#textbox-format-toolbar') ||
      e.target.closest('#image-opacity-toolbar')
    ) {
      return;
    }

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    if (e.target === e.currentTarget) {
      setPageBgPaletteOpen(false);
      setShapeMenuOpen(false);
      setTableMenuOpen(false);
      setGalleryOpen(false);
      setPanelsVisible((prev) => !prev);
    }
  };

  // Yan Sayfa Yönetimi Çekmecesi için Filtrelenmiş Sayfa Listesi (0 Kapak + 1..400)
  const filteredPages = React.useMemo(() => {
    const allPages = Array.from({ length: TOTAL_PAGES + 1 }, (_, i) => i);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allPages;
    return allPages.filter((pageNum) => {
      const label = pageNum === 0 ? 'kapak sayfası 0' : `sayfa ${pageNum}`;
      const plainText = (pagesContent[pageNum] || '').replace(/<[^>]*>/g, ' ').toLowerCase();
      return label.includes(q) || String(pageNum).includes(q) || plainText.includes(q);
    });
  }, [searchQuery, pagesContent]);

  return (
    <div 
      onClick={handleBackgroundClick}
      className="relative flex flex-col w-full h-screen wooden-desk-surface text-slate-800 overflow-hidden select-none"
    >
      {/* Google Fonts ve Özel CSS Kuralları */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Alex+Brush&family=Allura&family=Amatic+SC:wght@700&family=Anton&family=Architects+Daughter&family=Audiowide&family=Bangers&family=Bebas+Neue&family=Black+Ops+One&family=Bungee&family=Caveat:wght@600;700&family=Cinzel+Decorative:wght@700&family=Comfortaa:wght@500;700&family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Creepster&family=Dancing+Script:wght@700&family=Fredoka:wght@500;700&family=Gloria+Hallelujah&family=Great+Vibes&family=Homemade+Apple&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;700&family=Lobster&family=Luckiest+Guy&family=Monoton&family=Orbitron:wght@500;700&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:ital,wght@0,600;0,800;1,600&family=Press+Start+2P&family=Righteous&family=Rock+Salt&family=Russo+One&family=Sacramento&family=Satisfy&family=Shadows+Into+Light&family=Special+Elite&family=Syne:wght@600;800&family=UnifrakturMaguntia&display=swap');

        /* Gerçekçi Doğal Ahşap Çalışma Masası Yüzeyi */
        .wooden-desk-surface {
          background-color: #6e4726;
          background-image:
            radial-gradient(ellipse at 32% 24%, rgba(255, 244, 214, 0.34) 0%, rgba(255, 232, 185, 0.12) 42%, rgba(28, 15, 5, 0.58) 100%),
            repeating-linear-gradient(
              0deg,
              transparent 0px,
              transparent 168px,
              rgba(36, 19, 6, 0.42) 169px,
              rgba(255, 224, 180, 0.14) 171px,
              transparent 172px
            ),
            repeating-linear-gradient(
              1.5deg,
              rgba(46, 25, 9, 0.14) 0px,
              rgba(46, 25, 9, 0.14) 1px,
              transparent 1px,
              transparent 9px,
              rgba(154, 102, 54, 0.11) 9px,
              rgba(154, 102, 54, 0.11) 12px,
              transparent 12px,
              transparent 27px
            ),
            repeating-linear-gradient(
              -1deg,
              rgba(255, 222, 178, 0.06) 0px,
              rgba(255, 222, 178, 0.06) 4px,
              rgba(58, 32, 12, 0.12) 4px,
              rgba(58, 32, 12, 0.12) 9px,
              transparent 9px,
              transparent 48px
            ),
            linear-gradient(145deg, #8c5c32 0%, #734823 45%, #563417 100%);
        }

        .book-on-desk-shadow {
          box-shadow:
            -14px 28px 48px -6px rgba(18, 9, 3, 0.72),
            10px 36px 65px -8px rgba(18, 9, 3, 0.62),
            0 14px 24px -4px rgba(18, 9, 3, 0.48);
          overflow: visible !important;
        }

        .agenda-textbox-wrapper {
          background-color: transparent;
          border: 1.5px solid transparent;
          border-radius: 12px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .agenda-textbox-wrapper.is-selected,
        .agenda-textbox-wrapper:focus-within,
        .agenda-textbox-wrapper:focus {
          border: 1.5px solid #38bdf8;
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.16), 0 10px 25px -5px rgba(15, 23, 42, 0.08);
        }
        .agenda-textbox-wrapper .drag-bar,
        .agenda-textbox-wrapper .resize-handle,
        .agenda-textbox-wrapper .resize-edge,
        .agenda-textbox-wrapper .rotate-handle {
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.12s ease;
        }
        .resize-edge {
          position: absolute;
          z-index: 45;
          user-select: none;
          touch-action: none;
          background: transparent;
        }
        .resize-edge-n { top: -6px; left: 10px; right: 10px; height: 12px; cursor: n-resize; }
        .resize-edge-s { bottom: -6px; left: 10px; right: 10px; height: 12px; cursor: s-resize; }
        .resize-edge-w { left: -6px; top: 10px; bottom: 10px; width: 12px; cursor: w-resize; }
        .resize-edge-e { right: -6px; top: 10px; bottom: 10px; width: 12px; cursor: e-resize; }
        .resize-edge-n::after, .resize-edge-s::after {
          content: '';
          position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
          width: 24px; height: 4px; border-radius: 9999px; background: #0284c7; border: 1.5px solid #ffffff; box-shadow: 0 1px 4px rgba(2, 132, 199, 0.45);
        }
        .resize-edge-w::after, .resize-edge-e::after {
          content: '';
          position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
          width: 4px; height: 24px; border-radius: 9999px; background: #0284c7; border: 1.5px solid #ffffff; box-shadow: 0 1px 4px rgba(2, 132, 199, 0.45);
        }
        .agenda-textbox-wrapper::before,
        .agenda-image-wrapper::before {
          content: '';
          position: absolute; left: -4px; right: -4px; top: -68px; height: 72px; background: transparent; pointer-events: none; z-index: 40;
        }
        .agenda-textbox-wrapper.is-selected::before,
        .agenda-textbox-wrapper:focus-within::before,
        .agenda-textbox-wrapper:focus::before,
        .agenda-image-wrapper.is-selected::before,
        .agenda-image-wrapper:focus::before {
          pointer-events: auto;
        }
        .agenda-textbox-wrapper .drag-bar::before {
          content: '';
          position: absolute; left: -6px; right: -6px; top: -8px; bottom: -10px; background: transparent; pointer-events: none;
        }
        .agenda-textbox-wrapper.is-selected .drag-bar,
        .agenda-textbox-wrapper:focus-within .drag-bar,
        .agenda-textbox-wrapper:focus .drag-bar,
        .agenda-textbox-wrapper.is-selected .rotate-handle,
        .agenda-textbox-wrapper:focus-within .rotate-handle,
        .agenda-textbox-wrapper:focus .rotate-handle {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        .agenda-textbox-wrapper.is-selected .resize-handle,
        .agenda-textbox-wrapper.is-selected .resize-edge,
        .agenda-textbox-wrapper:focus-within .resize-handle,
        .agenda-textbox-wrapper:focus-within .resize-edge,
        .agenda-textbox-wrapper:focus .resize-handle,
        .agenda-textbox-wrapper:focus .resize-edge {
          opacity: 1;
          pointer-events: auto;
        }
        .agenda-image-wrapper {
          border: 2px solid transparent;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .agenda-image-wrapper.is-selected {
          border: 2px solid #0284c7;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.18);
          outline: none;
        }
        .agenda-image-wrapper .drag-bar,
        .agenda-image-wrapper .resize-handle,
        .agenda-image-wrapper .resize-edge,
        .agenda-image-wrapper .rotate-handle {
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.12s ease;
        }
        .agenda-image-wrapper.is-selected .drag-bar,
        .agenda-image-wrapper.is-selected .rotate-handle {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        .agenda-image-wrapper.is-selected .resize-handle,
        .agenda-image-wrapper.is-selected .resize-edge {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        .agenda-image-wrapper .drag-bar [data-agenda-delete="true"],
        .agenda-textbox-wrapper .drag-bar [data-agenda-delete="true"] {
          position: relative;
          z-index: 99 !important;
          pointer-events: auto !important;
        }
        .agenda-textbox-wrapper .drag-bar:active {
          cursor: grabbing !important;
        }
        .modern-bar-btn {
          width: 24px;
          height: 24px;
          border-radius: 9999px;
          border: none;
          background: transparent;
          color: #475569;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .modern-bar-btn:hover {
          background: #f1f5f9;
          color: #0f172a;
          transform: translateY(-1px);
        }
        .modern-bar-btn.is-locked {
          background: #fef3c7;
          color: #d97706;
        }
        .modern-close-btn {
          width: 24px;
          height: 24px;
          border-radius: 9999px;
          border: none;
          margin-left: 2px;
          background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%);
          color: #e11d48;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .modern-close-btn:hover {
          background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
          color: #ffffff;
          box-shadow: 0 3px 8px rgba(225, 29, 72, 0.35);
          transform: scale(1.06);
        }
        .agenda-textbox-content:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
          display: block;
        }
        .agenda-textbox-content {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .agenda-textbox-wrapper[data-box-shape="sticky"] {
          background-color: var(--box-bg, #fef08a);
          border-radius: 2px 2px 24px 2px !important;
          box-shadow: 0 10px 20px -5px rgba(15, 23, 42, 0.14), inset 0 -12px 20px rgba(0, 0, 0, 0.03);
        }
        .agenda-textbox-wrapper[data-box-shape="sticky"]::after {
          content: '';
          position: absolute; right: 0; bottom: 0; width: 24px; height: 24px;
          background: linear-gradient(135deg, rgba(0,0,0,0.12) 50%, rgba(255,255,255,0.75) 50%);
          border-top-left-radius: 6px; pointer-events: none;
        }
        .agenda-textbox-wrapper[data-box-shape="heart"] .agenda-textbox-content {
          clip-path: polygon(
            50% 21%, 54% 15%, 59% 10%, 65% 6%, 71% 5%, 78% 6%, 84% 9%, 90% 14%,
            94% 21%, 97% 29%, 97% 37%, 95% 46%, 91% 54%, 85% 63%, 77% 72%,
            68% 81%, 59% 89%, 50% 96%, 41% 89%, 32% 81%, 23% 72%, 15% 63%,
            9% 54%, 5% 46%, 3% 37%, 3% 29%, 6% 21%, 10% 14%, 16% 9%, 22% 6%,
            29% 5%, 35% 6%, 41% 10%, 46% 15%
          );
          background-color: var(--box-bg, #ffe4e6);
          padding: 28px 26px 30px 26px !important;
          display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="heart"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(225, 29, 72, 0.2));
        }
        .agenda-textbox-wrapper[data-box-shape="bubble"] .agenda-textbox-content {
          clip-path: polygon(0% 0%, 100% 0%, 100% 80%, 34% 80%, 16% 100%, 20% 80%, 0% 80%);
          background-color: var(--box-bg, #e0f2fe);
          border-radius: 16px; padding: 12px 14px 26px 14px !important;
        }
        .agenda-textbox-wrapper[data-box-shape="bubble"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 12px rgba(2, 132, 199, 0.18));
        }
        .agenda-textbox-wrapper[data-box-shape="ribbon"] .agenda-textbox-content {
          clip-path: polygon(0% 0%, 92% 0%, 100% 50%, 92% 100%, 0% 100%, 6% 50%);
          background-color: var(--box-bg, #e0f2fe);
          padding: 16px 26px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="ribbon"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.14));
        }
        .agenda-textbox-wrapper[data-box-shape="frame"] {
          background-color: var(--box-bg, #f8fafc);
          border: 2px solid rgba(15, 23, 42, 0.25) !important;
          border-radius: 14px !important;
          box-shadow: inset 0 0 0 4px rgba(255, 255, 255, 0.65), 0 8px 20px -4px rgba(15, 23, 42, 0.12);
        }
        .agenda-textbox-wrapper[data-box-shape="frame"] .agenda-textbox-content { padding: 14px 16px !important; }
        .agenda-textbox-wrapper[data-box-shape="star"] .agenda-textbox-content {
          clip-path: polygon(50% 0%, 63% 32%, 98% 35%, 71% 58%, 79% 92%, 50% 73%, 21% 92%, 29% 58%, 2% 35%, 37% 32%);
          background-color: var(--box-bg, #fef3c7);
          padding: 32px 28px 24px 28px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="star"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(217, 119, 6, 0.2));
        }
        .agenda-textbox-wrapper[data-box-shape="hexagon"] .agenda-textbox-content {
          clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
          background-color: var(--box-bg, #f3e8ff);
          padding: 18px 28px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="hexagon"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(124, 58, 237, 0.18));
        }
        .agenda-textbox-wrapper[data-box-shape="oval"] {
          background-color: var(--box-bg, #dcfce7); border-radius: 9999px !important; box-shadow: 0 8px 18px -4px rgba(15, 23, 42, 0.12);
        }
        .agenda-textbox-wrapper[data-box-shape="oval"] .agenda-textbox-content {
          padding: 18px 26px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="torn"] .agenda-textbox-content {
          clip-path: polygon(0% 3%, 8% 0%, 16% 4%, 25% 1%, 34% 4%, 43% 0%, 52% 3%, 61% 1%, 70% 4%, 79% 0%, 88% 3%, 96% 1%, 100% 4%, 100% 96%, 92% 100%, 84% 96%, 75% 99%, 66% 96%, 57% 100%, 48% 97%, 39% 100%, 30% 96%, 21% 99%, 12% 96%, 4% 100%, 0% 97%);
          background-color: var(--box-bg, #fef9c3); padding: 14px 14px !important;
        }
        .agenda-textbox-wrapper[data-box-shape="torn"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 12px rgba(15, 23, 42, 0.16));
        }
        .agenda-textbox-wrapper[data-box-shape="rect"] {
          background-color: var(--box-bg, #bae6fd); border-radius: 10px !important; box-shadow: 0 6px 14px -4px rgba(15, 23, 42, 0.12);
        }
        .agenda-textbox-wrapper[data-box-shape="circle"] {
          background-color: var(--box-bg, #fbcfe8); border-radius: 9999px !important; box-shadow: 0 8px 18px -4px rgba(15, 23, 42, 0.12);
        }
        .agenda-textbox-wrapper[data-box-shape="circle"] .agenda-textbox-content {
          padding: 20px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="triangle"] .agenda-textbox-content {
          clip-path: polygon(50% 4%, 98% 96%, 2% 96%); background-color: var(--box-bg, #fde047);
          padding: 42px 24px 16px 24px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="triangle"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.14));
        }
        .agenda-textbox-wrapper[data-box-shape="diamond"] .agenda-textbox-content {
          clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%); background-color: var(--box-bg, #ddd6fe);
          padding: 26px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="diamond"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.14));
        }
        .agenda-textbox-wrapper[data-box-shape="arrow"] .agenda-textbox-content {
          clip-path: polygon(0% 24%, 64% 24%, 64% 4%, 100% 50%, 64% 96%, 64% 76%, 0% 76%); background-color: var(--box-bg, #bbf7d0);
          padding: 18px 42px 18px 16px !important; display: flex; flex-direction: column; justify-content: center; text-align: center;
        }
        .agenda-textbox-wrapper[data-box-shape="arrow"] {
          background-color: transparent !important; filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.14));
        }
        #textbox-format-toolbar button { outline: none !important; -webkit-tap-highlight-color: transparent; }
        .page-flip-stage { perspective: 2800px; transform-style: preserve-3d; }
        
        /* Defter Kağıdı Düzenleri */
        .notebook-page-surface {
          background-image: radial-gradient(rgba(15, 23, 42, 0.022) 1px, transparent 0);
          background-size: 18px 18px;
        }
        .notebook-page-lined {
          background-image:
            linear-gradient(90deg, transparent 42px, rgba(239, 68, 68, 0.26) 42px, rgba(239, 68, 68, 0.26) 43.5px, transparent 43.5px),
            repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, rgba(59, 130, 246, 0.28) 31px, rgba(59, 130, 246, 0.28) 32px);
          background-size: 100% 100%, 100% 32px;
          background-position: 0 0, 0 38px;
        }
        .notebook-page-grid {
          background-image:
            linear-gradient(to right, rgba(59, 130, 246, 0.22) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(59, 130, 246, 0.22) 1px, transparent 1px);
          background-size: 16px 16px;
          background-position: 16px 16px;
        }
        .notebook-page-dotted {
          background-image: radial-gradient(rgba(100, 116, 139, 0.35) 1.2px, transparent 0);
          background-size: 14px 14px;
          background-position: 7px 7px;
        }
        .notebook-left-edge {
          box-shadow: inset 12px 0 22px -12px rgba(15, 23, 42, 0.14), inset 4px 0 0 rgba(15, 23, 42, 0.04);
        }
        .notebook-right-edge {
          box-shadow: inset -12px 0 22px -12px rgba(15, 23, 42, 0.14), inset -4px 0 0 rgba(15, 23, 42, 0.04);
        }
      `}</style>

      {/* ÜST KONTROL PANELİ (Tıklamayla Gizlenip Açılır) */}
      <header
        onClick={(e) => e.stopPropagation()}
        className={`fixed top-0 left-0 right-0 z-40 h-14 px-4 sm:px-6 bg-white/90 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between transition-all duration-300 ${
          panelsVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-700 transition flex items-center gap-2"
            title="Sayfa Yönetimi"
          >
            <BookOpen className="w-5 h-5 text-slate-700" />
            <span className="text-xs font-semibold hidden sm:inline">Sayfa Yönetimi</span>
          </button>

          <button
            type="button"
            onClick={handleUndo}
            disabled={undoCount === 0}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-35 disabled:hover:bg-slate-100 text-slate-700 transition flex items-center gap-1.5 text-xs font-semibold"
            title="Son Hamleyi Geri Al (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
            <span className="hidden sm:inline">Geri Al</span>
          </button>
        </div>

        {/* ORTA: SAYFA GÖSTERGESİ VE İLERİ / GERİ GEÇİŞ BÖLMESİ */}
        <div className="flex items-center gap-1 bg-slate-100/90 border border-slate-200/80 px-1.5 py-1 rounded-xl shadow-2xs">
          <button
            type="button"
            onClick={() => triggerAnimatedTurn('prev')}
            disabled={currentLeftPage <= 0}
            className="p-1.5 rounded-lg hover:bg-white hover:shadow-2xs disabled:opacity-35 disabled:hover:bg-transparent text-slate-700 transition"
            title="Önceki Sayfa"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="px-2.5 py-1 rounded-lg hover:bg-white/80 text-xs font-bold text-slate-800 min-w-[110px] sm:min-w-[135px] text-center transition"
            title="Tüm Sayfa İndeksini Aç"
          >
            {isCoverView
              ? 'Kapak (0)'
              : `Sayfa ${currentLeftPage} - ${currentRightPage}`}
          </button>

          <button
            type="button"
            onClick={() => triggerAnimatedTurn('next')}
            disabled={!isCoverView && currentRightPage >= TOTAL_PAGES}
            className="p-1.5 rounded-lg hover:bg-white hover:shadow-2xs disabled:opacity-35 disabled:hover:bg-transparent text-slate-700 transition"
            title="Sonraki Sayfa"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => setSyncModalOpen(true)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
              syncStatus === 'synced'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : syncStatus === 'syncing'
                ? 'bg-sky-50 text-sky-700 border-sky-200'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
            title="Bulut Senkronizasyonu ve Cihaz Eşleştirme"
          >
            {syncStatus === 'syncing' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
            ) : syncStatus === 'synced' ? (
              <Cloud className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Cloud className="w-3.5 h-3.5 text-slate-600" />
            )}
            <span className="hidden sm:inline">
              {syncStatus === 'syncing'
                ? 'Eşitleniyor...'
                : syncStatus === 'synced'
                ? 'Bulutta Kayıtlı'
                : 'Bulut Eşitle'}
            </span>
          </button>
          <span className="text-[11px] text-slate-400 hidden lg:inline">Gizle: Dışa Tıkla</span>
        </div>
      </header>

      {/* YAN SAYFA YÖNETİMİ ÇEKMECESİ */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-[1px] flex"
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="w-80 max-w-[85vw] h-full bg-white shadow-2xl border-r border-slate-200 flex flex-col"
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-slate-800" />
                <h2 className="font-bold text-sm text-slate-800">400 Sayfa İndeksi</h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Arama ve Dışa Aktar */}
            <div className="p-3 border-b border-slate-100 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Sayfa no veya not ara..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={exportNotebook}
                className="p-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition flex items-center gap-1.5 text-xs font-medium"
                title="Ajandayı İndir"
              >
                <Download className="w-3.5 h-3.5" />
                <span>İndir</span>
              </button>
            </div>

            {/* 400 Sayfa İndeksi */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredPages.map((pageNum) => {
                const rawHtml = pagesContent[pageNum] || '';
                const plainText = rawHtml.replace(/<[^>]*>/g, ' ').trim();
                const isCurrent = pageNum === currentLeftPage || (!isCoverView && pageNum === currentRightPage);

                return (
                  <div
                    key={pageNum}
                    onClick={() => {
                      goToPagePair(pageNum);
                      setDrawerOpen(false);
                    }}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition ${
                      isCurrent
                        ? 'bg-slate-900 text-white'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-slate-300' : 'text-slate-400'}`} />
                      <div className="truncate">
                        <span className="text-xs font-semibold">
                          {pageNum === 0 ? 'Kapak Sayfası (0)' : `Sayfa ${pageNum}`}
                        </span>
                        {plainText && (
                          <p className={`text-[11px] truncate ${isCurrent ? 'text-slate-300' : 'text-slate-400'}`}>
                            {plainText}
                          </p>
                        )}
                      </div>
                    </div>

                    {plainText && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveContent(pageNum, '');
                          if (pageNum === currentLeftPage && leftEditorRef.current) leftEditorRef.current.innerHTML = '';
                          if (!isCoverView && pageNum === currentRightPage && rightEditorRef.current) rightEditorRef.current.innerHTML = '';
                        }}
                        className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 ${
                          isCurrent ? 'text-red-300' : 'text-red-500'
                        } transition`}
                        title="Sayfa İçeriğini Temizle"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      {/* MERKEZİ AÇIK AJANDA ALANI (İlk Sayfa Tek Kapak Sayfası + Sonraki Sayfalar Çift Sayfa - A5 Boyut Oranı) */}
      <main
        className={`relative flex-1 w-full h-full flex items-center justify-center p-4 sm:p-7 md:pr-24 md:py-12 page-flip-stage transition-all duration-300 ${
          activeTextBoxId ? 'xl:pl-[330px] md:pl-10' : selectedImageOpacity !== null ? 'xl:pl-[250px] md:pl-10' : 'md:pl-10'
        }`}
      >
        {/* SEÇİLİ RESİM / BANT SAYDAMLIK (OPAKLIK) AYAR ÇUBUĞU (SOL MASA KENARINDA DURUR, SAYFAYI KAPATMAZ) */}
        {selectedImageOpacity !== null && (
          <div
            id="image-opacity-toolbar"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed top-16 xl:top-1/2 xl:-translate-y-1/2 left-1/2 -translate-x-1/2 xl:left-4 xl:translate-x-0 z-50 flex flex-col gap-2.5 p-3 bg-white/95 backdrop-blur-md border border-slate-200/95 rounded-2xl shadow-[0_14px_34px_rgba(15,23,42,0.22)] text-xs w-[280px] xl:w-[220px] max-w-[92vw]"
          >
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-[11px] font-bold text-sky-700 tracking-wide">Görsel Ayarları</span>
              <button
                type="button"
                onClick={() => {
                  selectedImageElementRef.current = null;
                  setSelectedImageId(null);
                  setSelectedImageOpacity(null);
                }}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                title="Paneli Kapat"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-600 text-[11px]">Saydamlık</span>
                <span className="font-mono font-bold text-sky-700 text-[11px]">%{selectedImageOpacity}</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                value={selectedImageOpacity}
                onInput={(e) => {
                  const val = Number(e.target.value);
                  setSelectedImageOpacity(val);
                  const selRef = selectedImageElementRef.current;
                  if (selRef && selRef.itemId && selRef.pageNum !== undefined) {
                    updateItemOnPage(selRef.pageNum, selRef.itemId, { opacity: val }, false);
                    return;
                  }
                  const wrapperEl = (selRef instanceof HTMLElement ? selRef : null) || document.querySelector('.agenda-image-wrapper.is-selected');
                  if (wrapperEl) {
                    wrapperEl.setAttribute('data-opacity', String(val));
                    const imgEl = wrapperEl.querySelector<HTMLElement>('.agenda-image-target');
                    const tapeEl = wrapperEl.querySelector<HTMLElement>('.tape-freehand-strip');
                    const targetMedia = imgEl || tapeEl;
                    if (targetMedia) {
                      targetMedia.style.setProperty('opacity', (val / 100).toFixed(2), 'important');
                    }
                  }
                }}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSelectedImageOpacity(val);
                  const selRef = selectedImageElementRef.current;
                  if (selRef && selRef.itemId && selRef.pageNum !== undefined) {
                    updateItemOnPage(selRef.pageNum, selRef.itemId, { opacity: val }, true);
                    return;
                  }
                  const wrapperEl = (selRef instanceof HTMLElement ? selRef : null) || document.querySelector('.agenda-image-wrapper.is-selected');
                  if (wrapperEl) {
                    wrapperEl.setAttribute('data-opacity', String(val));
                    const imgEl = wrapperEl.querySelector<HTMLElement>('.agenda-image-target');
                    const tapeEl = wrapperEl.querySelector<HTMLElement>('.tape-freehand-strip');
                    const targetMedia = imgEl || tapeEl;
                    if (targetMedia) {
                      targetMedia.style.setProperty('opacity', (val / 100).toFixed(2), 'important');
                    }
                    if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
                    if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
                  }
                }}
                className="w-full accent-sky-600 cursor-pointer"
              />
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {[25, 50, 75, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setSelectedImageOpacity(preset);
                      const selRef = selectedImageElementRef.current;
                      if (selRef && selRef.itemId && selRef.pageNum !== undefined) {
                        updateItemOnPage(selRef.pageNum, selRef.itemId, { opacity: preset }, true);
                        return;
                      }
                      const wrapperEl = (selRef instanceof HTMLElement ? selRef : null) || document.querySelector('.agenda-image-wrapper.is-selected');
                      if (wrapperEl) {
                        wrapperEl.setAttribute('data-opacity', String(preset));
                        const imgEl = wrapperEl.querySelector<HTMLElement>('.agenda-image-target');
                        const tapeEl = wrapperEl.querySelector<HTMLElement>('.tape-freehand-strip');
                        const targetMedia = imgEl || tapeEl;
                        if (targetMedia) {
                          targetMedia.style.setProperty('opacity', (preset / 100).toFixed(2), 'important');
                        }
                        if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
                        if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
                      }
                    }}
                    className={`py-1 rounded-md text-[10px] font-bold transition ${
                      selectedImageOpacity === preset
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    %{preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-semibold text-slate-600">Katman:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const selRef = selectedImageElementRef.current;
                    if (selRef && selRef.itemId && selRef.pageNum !== undefined) {
                      changeLayerOrder('front', null, selRef.itemId, selRef.pageNum);
                    } else {
                      changeLayerOrder('front');
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold transition"
                  title="Seçili Görseli En Öne Al"
                >
                  Öne Al
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const selRef = selectedImageElementRef.current;
                    if (selRef && selRef.itemId && selRef.pageNum !== undefined) {
                      changeLayerOrder('back', null, selRef.itemId, selRef.pageNum);
                    } else {
                      changeLayerOrder('back');
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold transition"
                  title="Seçili Görseli En Arkaya Al"
                >
                  Arkaya Al
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AKTİF METİN KUTUSU BİÇİMLENDİRME ARAÇ ÇUBUĞU (KAĞIDIN VE METİN KUTUSUNUN ÖNÜNÜ KAPATMAZ, MASA KENARINDA DURUR) */}
        {activeTextBoxId && (
          <div
            id="textbox-format-toolbar"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
              }
              e.stopPropagation();
            }}
            className="fixed bottom-16 xl:bottom-auto xl:top-1/2 xl:-translate-y-1/2 left-1/2 -translate-x-1/2 xl:left-4 xl:translate-x-0 z-50 flex flex-col gap-1.5 p-2.5 bg-white/95 backdrop-blur-md border border-slate-200/95 rounded-2xl shadow-[0_14px_34px_rgba(15,23,42,0.22)] text-xs w-[340px] xl:w-[300px] max-w-[94vw] max-h-[42vh] xl:max-h-[calc(100vh-8.5rem)] overflow-y-auto"
          >
            {/* Üst Başlık ve Hızlı Kapatma */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-[11px] font-bold text-sky-700 tracking-wide">Metin Kutusu Biçimi</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActiveTextBoxId(null);
                  setFontMenuOpen(false);
                  setColorPaletteOpen(false);
                  setBgPaletteOpen(false);
                }}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                title="Biçimlendirme Çubuğunu Kapat"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 1. SATIR: STİL ŞABLONU, CANLI YAZI TİPİ ÖNİZLEMESİ, BOYUT, BÜYÜT/KÜÇÜLT */}
            <div className="flex flex-wrap items-center gap-1">
              {/* Paragraf / Başlık Stili */}
              <select
                value={currentHeadingStyle}
                onChange={(e) => applyTextFormat('headingStyle', e.target.value)}
                className="h-7 px-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 text-[11px] font-semibold outline-none cursor-pointer"
                title="Paragraf ve Başlık Stili"
              >
                <option value="p">Normal Metin</option>
                <option value="h1">Başlık 1</option>
                <option value="h2">Başlık 2</option>
                <option value="h3">Alt Başlık</option>
                <option value="quote">Alıntı</option>
              </select>

              {/* Canlı Önizlemeli Yazı Tipi Seçici */}
              <div className="relative flex-1 min-w-[120px]">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFontMenuOpen((prev) => !prev);
                    setColorPaletteOpen(false);
                    setBgPaletteOpen(false);
                  }}
                  style={{ fontFamily: currentFontFamily }}
                  className="h-7 px-2 w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 text-xs font-medium flex items-center justify-between gap-1 outline-none cursor-pointer transition"
                  title="Yazı Tipi Seç (40 Farklı Karakter)"
                >
                  <span className="truncate">
                    {(() => {
                      const allFonts = [
                        { value: "'Calibri', 'Carlito', 'Segoe UI', sans-serif", label: 'Calibri (Klasik Ofis)' },
                        { value: "'Arial', 'Helvetica Neue', sans-serif", label: 'Arial (Standart Düz)' },
                        { value: "'Times New Roman', Times, serif", label: 'Times New Roman (Resmi Klasik)' },
                        { value: "'Georgia', serif", label: 'Georgia (Zarif Kitap)' },
                        { value: "'Verdana', Geneva, sans-serif", label: 'Verdana (Geniş & Okunaklı)' },
                        { value: "'Tahoma', Geneva, sans-serif", label: 'Tahoma (Net & Dengeli)' },
                        { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS (Modern Klasik)' },
                        { value: "'Cambria', Georgia, serif", label: 'Cambria (Belge & Rapor)' },
                        { value: "'Garamond', 'EB Garamond', serif", label: 'Garamond (Klasik Edebiyat)' },
                        { value: "'Segoe UI', 'Inter', sans-serif", label: 'Segoe UI (Windows Klasik)' },
                        { value: "'Caveat', cursive", label: 'Caveat (Doğal El Yazısı)' },
                        { value: "'Homemade Apple', cursive", label: 'Homemade Apple (Dolma Kalem)' },
                        { value: "'Architects Daughter', cursive", label: 'Architects Daughter (Mimar Notu)' },
                        { value: "'Gloria Hallelujah', cursive", label: 'Gloria Hallelujah (Çizgili Defter)' },
                        { value: "'Shadows Into Light', cursive", label: 'Shadows Into Light (İnce Kalem)' },
                        { value: "'Rock Salt', cursive", label: 'Rock Salt (Fırça El Yazısı)' },
                        { value: "'Permanent Marker', cursive", label: 'Permanent Marker (Keçeli Kalem)' },
                        { value: "'Amatic SC', cursive", label: 'Amatic SC (Uzun İnce El Yazısı)' },
                        { value: "'Great Vibes', cursive", label: 'Great Vibes (Kraliyet İmzası)' },
                        { value: "'Alex Brush', cursive", label: 'Alex Brush (Zarif Fırça)' },
                        { value: "'Allura', cursive", label: 'Allura (Akıcı Kaligrafi)' },
                        { value: "'Dancing Script', cursive", label: 'Dancing Script (Kıvrımlı Yazı)' },
                        { value: "'Sacramento', cursive", label: 'Sacramento (İnce İmza)' },
                        { value: "'Satisfy', cursive", label: 'Satisfy (Klasik El Yazısı)' },
                        { value: "'Pacifico', cursive", label: 'Pacifico (Sörf & Retro)' },
                        { value: "'Lobster', cursive", label: 'Lobster (Kalın El Yazısı)' },
                        { value: "'Orbitron', sans-serif", label: 'Orbitron (Uzay & Bilim Kurgu)' },
                        { value: "'Audiowide', sans-serif", label: 'Audiowide (Tekno & Siber)' },
                        { value: "'Russo One', sans-serif", label: 'Russo One (Geometrik Güçlü)' },
                        { value: "'Press Start 2P', cursive", label: 'Press Start 2P (8-Bit Piksel)' },
                        { value: "'Black Ops One', cursive", label: 'Black Ops One (Askeri Şablon)' },
                        { value: "'Bungee', sans-serif", label: 'Bungee (Şehir Tabelası)' },
                        { value: "'Monoton', cursive", label: 'Monoton (Neon Çizgili)' },
                        { value: "'Syne', sans-serif", label: 'Syne (Avangart Sanat)' },
                        { value: "'Bangers', cursive", label: 'Bangers (Çizgi Roman)' },
                        { value: "'Luckiest Guy', cursive", label: 'Luckiest Guy (Karikatür Başlık)' },
                        { value: "'Righteous', sans-serif", label: "Righteous (70'ler Retro)" },
                        { value: "'Fredoka', sans-serif", label: 'Fredoka (Yuvarlak Balon)' },
                        { value: "'Comfortaa', cursive", label: 'Comfortaa (Yumuşak Geometrik)' },
                        { value: "'Creepster', cursive", label: 'Creepster (Korku & Gizem)' },
                        { value: "'UnifrakturMaguntia', cursive", label: 'Unifraktur (Ortaçağ Gotik)' },
                        { value: "'Cinzel Decorative', serif", label: 'Cinzel Decorative (Roma)' },
                        { value: "'Abril Fatface', serif", label: 'Abril Fatface (Dergi Kapağı)' },
                        { value: "'Playfair Display', serif", label: 'Playfair Display (Klasik Kitap)' },
                        { value: "'Cormorant Garamond', serif", label: 'Cormorant (Edebiyat Serifi)' },
                        { value: "'Special Elite', cursive", label: 'Special Elite (Eski Daktilo)' },
                        { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono (Kod & Terminal)' },
                        { value: "'Bebas Neue', sans-serif", label: 'Bebas Neue (Dar Uzun Poster)' },
                        { value: "'Anton', sans-serif", label: 'Anton (Kalın Manşet)' },
                        { value: "'Inter', sans-serif", label: 'Inter (Sade Modern)' }
                      ];
                      const found = allFonts.find((f) => f.value === currentFontFamily);
                      return found ? found.label.split(' (')[0] : 'Inter';
                    })()}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">▾</span>
                </button>

                {fontMenuOpen && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    className="fixed left-4 top-20 w-72 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl z-[60] py-1.5"
                  >
                    {[
                      {
                        group: 'Klasik & En Çok Kullanılanlar',
                        items: [
                          { value: "'Calibri', 'Carlito', 'Segoe UI', sans-serif", label: 'Calibri', desc: 'Klasik Ofis' },
                          { value: "'Arial', 'Helvetica Neue', sans-serif", label: 'Arial', desc: 'Standart Düz' },
                          { value: "'Times New Roman', Times, serif", label: 'Times New Roman', desc: 'Resmi Klasik' },
                          { value: "'Georgia', serif", label: 'Georgia', desc: 'Zarif Kitap' },
                          { value: "'Verdana', Geneva, sans-serif", label: 'Verdana', desc: 'Geniş & Okunaklı' },
                          { value: "'Tahoma', Geneva, sans-serif", label: 'Tahoma', desc: 'Net & Dengeli' },
                          { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS', desc: 'Modern Klasik' },
                          { value: "'Cambria', Georgia, serif", label: 'Cambria', desc: 'Belge & Rapor' },
                          { value: "'Garamond', 'EB Garamond', serif", label: 'Garamond', desc: 'Klasik Edebiyat' },
                          { value: "'Segoe UI', 'Inter', sans-serif", label: 'Segoe UI', desc: 'Windows Klasik' }
                        ]
                      },
                      {
                        group: 'El Yazısı & Günlük',
                        items: [
                          { value: "'Caveat', cursive", label: 'Caveat', desc: 'Doğal El Yazısı' },
                          { value: "'Homemade Apple', cursive", label: 'Homemade Apple', desc: 'Dolma Kalem' },
                          { value: "'Architects Daughter', cursive", label: 'Architects Daughter', desc: 'Mimar Notu' },
                          { value: "'Gloria Hallelujah', cursive", label: 'Gloria Hallelujah', desc: 'Çizgili Defter' },
                          { value: "'Shadows Into Light', cursive", label: 'Shadows Into Light', desc: 'İnce Kalem' },
                          { value: "'Rock Salt', cursive", label: 'Rock Salt', desc: 'Fırça El Yazısı' },
                          { value: "'Permanent Marker', cursive", label: 'Permanent Marker', desc: 'Keçeli Kalem' },
                          { value: "'Amatic SC', cursive", label: 'Amatic SC', desc: 'Uzun İnce El Yazısı' }
                        ]
                      },
                      {
                        group: 'Kaligrafi & Davetiye',
                        items: [
                          { value: "'Great Vibes', cursive", label: 'Great Vibes', desc: 'Kraliyet İmzası' },
                          { value: "'Alex Brush', cursive", label: 'Alex Brush', desc: 'Zarif Fırça' },
                          { value: "'Allura', cursive", label: 'Allura', desc: 'Akıcı Kaligrafi' },
                          { value: "'Dancing Script', cursive", label: 'Dancing Script', desc: 'Kıvrımlı Yazı' },
                          { value: "'Sacramento', cursive", label: 'Sacramento', desc: 'İnce İmza' },
                          { value: "'Satisfy', cursive", label: 'Satisfy', desc: 'Klasik El Yazısı' },
                          { value: "'Pacifico', cursive", label: 'Pacifico', desc: 'Sörf & Retro' },
                          { value: "'Lobster', cursive", label: 'Lobster', desc: 'Kalın El Yazısı' }
                        ]
                      },
                      {
                        group: 'Fütüristik, Bilim Kurgu & Oyun',
                        items: [
                          { value: "'Orbitron', sans-serif", label: 'Orbitron', desc: 'Uzay & Bilim Kurgu' },
                          { value: "'Audiowide', sans-serif", label: 'Audiowide', desc: 'Tekno & Siber' },
                          { value: "'Russo One', sans-serif", label: 'Russo One', desc: 'Geometrik Güçlü' },
                          { value: "'Press Start 2P', cursive", label: 'Press Start 2P', desc: '8-Bit Piksel' },
                          { value: "'Black Ops One', cursive", label: 'Black Ops One', desc: 'Askeri Şablon' },
                          { value: "'Bungee', sans-serif", label: 'Bungee', desc: 'Şehir Tabelası' },
                          { value: "'Monoton', cursive", label: 'Monoton', desc: 'Neon Çizgili' },
                          { value: "'Syne', sans-serif", label: 'Syne', desc: 'Avangart Sanat' }
                        ]
                      },
                      {
                        group: 'Çizgi Roman, Retro & Eğlenceli',
                        items: [
                          { value: "'Bangers', cursive", label: 'Bangers', desc: 'Çizgi Roman' },
                          { value: "'Luckiest Guy', cursive", label: 'Luckiest Guy', desc: 'Karikatür Başlık' },
                          { value: "'Righteous', sans-serif", label: 'Righteous', desc: "70'ler Retro" },
                          { value: "'Fredoka', sans-serif", label: 'Fredoka', desc: 'Yuvarlak Balon' },
                          { value: "'Comfortaa', cursive", label: 'Comfortaa', desc: 'Yumuşak Geometrik' },
                          { value: "'Creepster', cursive", label: 'Creepster', desc: 'Korku & Gizem' }
                        ]
                      },
                      {
                        group: 'Gotik, Antik & Kitap',
                        items: [
                          { value: "'UnifrakturMaguntia', cursive", label: 'Unifraktur', desc: 'Ortaçağ Gotik' },
                          { value: "'Cinzel Decorative', serif", label: 'Cinzel Decorative', desc: 'Roma İmparatorluk' },
                          { value: "'Abril Fatface', serif", label: 'Abril Fatface', desc: 'Dergi Kapağı' },
                          { value: "'Playfair Display', serif", label: 'Playfair Display', desc: 'Klasik Kitap' },
                          { value: "'Cormorant Garamond', serif", label: 'Cormorant', desc: 'Edebiyat Serifi' }
                        ]
                      },
                      {
                        group: 'Daktilo, Poster & Modern',
                        items: [
                          { value: "'Special Elite', cursive", label: 'Special Elite', desc: 'Eski Daktilo' },
                          { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono', desc: 'Kod & Terminal' },
                          { value: "'Bebas Neue', sans-serif", label: 'Bebas Neue', desc: 'Dar Uzun Poster' },
                          { value: "'Anton', sans-serif", label: 'Anton', desc: 'Kalın Manşet' },
                          { value: "'Inter', sans-serif", label: 'Inter', desc: 'Sade Modern' }
                        ]
                      }
                    ].map((section) => (
                      <div key={section.group} className="mb-1.5">
                        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/80 sticky top-0">
                          {section.group}
                        </div>
                        {section.items.map((font) => {
                          const isSelected = currentFontFamily === font.value;
                          return (
                            <button
                              key={font.value}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applyTextFormat('fontFamily', font.value);
                                setFontMenuOpen(false);
                              }}
                              className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition ${
                                isSelected
                                  ? 'bg-sky-50 text-sky-900 font-semibold'
                                  : 'hover:bg-slate-50 text-slate-800'
                              }`}
                            >
                              <span
                                style={{ fontFamily: font.value }}
                                className="text-[15px] leading-snug truncate"
                              >
                                {font.label}
                              </span>
                              <span className="text-[10px] text-slate-400 font-sans shrink-0">
                                {font.desc}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Yazı Boyutu Seçici */}
              <select
                value={currentFontSize}
                onChange={(e) => applyTextFormat('fontSizePx', e.target.value)}
                className="h-7 px-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 text-[11px] font-medium outline-none cursor-pointer"
                title="Yazı Boyutu"
              >
                {Array.from(
                  new Set([
                    '10px', '11px', '12px', '14px', '15px', '16px', '18px', '20px',
                    '24px', '28px', '32px', '36px', '42px', '48px', '56px', '64px', '72px',
                    currentFontSize
                  ])
                )
                  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                  .map((sz) => (
                    <option key={sz} value={sz}>{sz.replace('px', '')}</option>
                  ))}
              </select>

              {/* A▲ Yazı Tipini Büyüt / A▼ Küçült */}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyTextFormat('stepFontSize', 2);
                }}
                className="h-7 px-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-bold"
                title="Yazı Tipini Büyüt"
              >
                A▲
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyTextFormat('stepFontSize', -2);
                }}
                className="h-7 px-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700 text-[10px] font-bold"
                title="Yazı Tipini Küçült"
              >
                A▼
              </button>
            </div>

            {/* 2. SATIR: HARF DURUMU, SATIR ARALIĞI, KUTU ŞEKLİ VE TEMEL YAZI BİÇİMLERİ */}
            <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-100">
              {/* Büyük/Küçük Harf Dönüştürücü (Aa) */}
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) applyTextFormat('changeCase', e.target.value);
                  e.target.value = '';
                }}
                className="h-7 px-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 text-[11px] font-semibold outline-none cursor-pointer"
                title="Büyük / Küçük Harf Değiştir"
              >
                <option value="" disabled>Aa</option>
                <option value="upper">TÜMÜ BÜYÜK HARF</option>
                <option value="lower">tümü küçük harf</option>
                <option value="title">Her Sözcüğü Büyük Başlat</option>
              </select>

              {/* Satır Aralığı */}
              <select
                value={currentLineHeight}
                onChange={(e) => applyTextFormat('lineHeight', e.target.value)}
                className="h-7 px-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 text-[11px] font-medium outline-none cursor-pointer"
                title="Satır Aralığı"
              >
                <option value="1.15">1.15</option>
                <option value="1.5">1.5</option>
                <option value="2.0">2.0</option>
                <option value="2.5">2.5</option>
              </select>

              {/* Kutu Şekli Seçici (Not Kağıdı, Kalp, Konuşma Balonu vb.) */}
              <select
                value={currentBoxShape}
                onChange={(e) => applyTextFormat('boxShape', e.target.value)}
                className="h-7 px-1.5 flex-1 min-w-[115px] bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md text-amber-900 text-[11px] font-semibold outline-none cursor-pointer"
                title="Metin Kutusu Şekli"
              >
                <option value="default">▭ Standart Kutu</option>
                <option value="sticky">📝 Not Kağıdı</option>
                <option value="frame">🖼️ Çerçeveli Kart</option>
                <option value="ribbon">🏷️ Kurdele Etiket</option>
                <option value="heart">❤️ Kalp Şekli</option>
                <option value="bubble">💬 Konuşma Balonu</option>
                <option value="star">⭐ Yıldız Şekli</option>
                <option value="hexagon">⬡ Altıgen</option>
                <option value="oval">⬭ Oval / Rozet</option>
                <option value="torn">📄 Yırtık Kağıt Notu</option>
              </select>
            </div>

            {/* 3. SATIR: YAZI TİPİ BİÇİMLERİ, LİSTELER, HİZALAMA */}
            <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-100">
              {/* Kalın, İtalik, Alt Çizgi, Üstü Çizili, Alt Simge, Üst Simge */}
              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'bold')}
                aria-pressed={activeStyles.bold}
                className={`w-7 h-7 rounded-md font-bold flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.bold
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Kalın (Ctrl+B)"
              >
                K
              </button>

              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'italic')}
                aria-pressed={activeStyles.italic}
                className={`w-7 h-7 rounded-md italic font-serif flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.italic
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="İtalik (Ctrl+I)"
              >
                T
              </button>

              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'underline')}
                aria-pressed={activeStyles.underline}
                className={`w-7 h-7 rounded-md underline flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.underline
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Altı Çizili (Ctrl+U)"
              >
                A
              </button>

              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'strikeThrough')}
                aria-pressed={activeStyles.strikeThrough}
                className={`w-7 h-7 rounded-md line-through flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.strikeThrough
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Üstü Çizili"
              >
                ab
              </button>

              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'subscript')}
                aria-pressed={activeStyles.subscript}
                className={`w-7 h-7 rounded-md text-[11px] flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.subscript
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Alt Simge (X₂)"
              >
                X₂
              </button>

              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'superscript')}
                aria-pressed={activeStyles.superscript}
                className={`w-7 h-7 rounded-md text-[11px] flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.superscript
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Üst Simge (X²)"
              >
                X²
              </button>

              <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

              {/* Madde İşaretli & Numaralı Liste ve Girinti */}
              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'insertUnorderedList')}
                aria-pressed={activeStyles.insertUnorderedList}
                className={`w-7 h-7 rounded-md text-xs font-bold flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.insertUnorderedList
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Madde İşaretli Liste"
              >
                •≡
              </button>

              <button
                type="button"
                onMouseDown={(e) => handleToolbarToggle(e, 'insertOrderedList')}
                aria-pressed={activeStyles.insertOrderedList}
                className={`w-7 h-7 rounded-md text-xs font-bold flex items-center justify-center transition-all focus:outline-none ${
                  activeStyles.insertOrderedList
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
                title="Numaralı Liste"
              >
                1.
              </button>

              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyTextFormat('outdent', null); }}
                className="w-7 h-7 rounded-md text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center justify-center"
                title="Girintiyi Azalt"
              >
                ⇤
              </button>

              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyTextFormat('indent', null); }}
                className="w-7 h-7 rounded-md text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center justify-center"
                title="Girintiyi Artır"
              >
                ⇥
              </button>

              <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

              {/* Hizalama (Sola, Ortaya, Sağa, İki Yana Yasla) */}
              {[
                { cmd: 'justifyLeft', Icon: AlignLeft, title: 'Sola Hizala' },
                { cmd: 'justifyCenter', Icon: AlignCenter, title: 'Ortala' },
                { cmd: 'justifyRight', Icon: AlignRight, title: 'Sağa Hizala' },
                { cmd: 'justifyFull', Icon: AlignJustify, title: 'İki Yana Yasla' }
              ].map((al) => (
                <button
                  key={al.cmd}
                  type="button"
                  onMouseDown={(e) => handleToolbarToggle(e, al.cmd)}
                  aria-pressed={activeStyles[al.cmd]}
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-all focus:outline-none ${
                    activeStyles[al.cmd]
                      ? 'bg-sky-500 text-white shadow-xs'
                      : 'bg-transparent text-slate-700 hover:bg-slate-100'
                  }`}
                  title={al.title}
                >
                  <al.Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            {/* 4. SATIR: KUTU RENGİ, YAZI RENGİ VE TEMİZLE */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-100">
              {/* Katman Sırası (Öne Al / Arkaya Al) */}
              <div className="flex items-center justify-between gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-200">
                <span className="text-[11px] font-bold text-slate-600">Katman</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const hitPage = Object.keys(pageItemsRef.current || {}).find((p) =>
                        (pageItemsRef.current[p] || []).some((it) => it.id === activeTextBoxId)
                      );
                      changeLayerOrder('front', null, activeTextBoxId, hitPage !== undefined ? Number(hitPage) : null);
                    }}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold transition"
                    title="En Öne Al"
                  >
                    Öne Al
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const hitPage = Object.keys(pageItemsRef.current || {}).find((p) =>
                        (pageItemsRef.current[p] || []).some((it) => it.id === activeTextBoxId)
                      );
                      changeLayerOrder('back', null, activeTextBoxId, hitPage !== undefined ? Number(hitPage) : null);
                    }}
                    className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold transition"
                    title="En Arkaya Al"
                  >
                    Arkaya Al
                  </button>
                </div>
              </div>

              {/* Şekil / Kutu Saydamlık Kaydırıcısı */}
              <div className="flex items-center justify-between gap-2 bg-slate-50 px-2 py-1 rounded-md border border-slate-200">
                <span className="text-[11px] font-bold text-slate-600 shrink-0">Saydamlık</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={currentBoxOpacity}
                  onInput={(e) => applyTextFormat('boxOpacity', e.target.value)}
                  onChange={(e) => applyTextFormat('boxOpacity', e.target.value)}
                  className="flex-1 accent-sky-600 cursor-pointer"
                  title="Şekil / Kutu Saydamlığı"
                />
                <span className="text-[10px] font-mono font-bold text-sky-700 w-8 text-right">
                  %{currentBoxOpacity}
                </span>
              </div>

              {/* Kutu Rengi Bölümü */}
              <div className="relative flex items-center justify-between gap-1 bg-slate-50 px-2 py-1 rounded-md border border-slate-200">
                <span className="text-[11px] font-bold text-slate-600 shrink-0">
                  {activeTableCell && activeTableCell.boxId === activeTextBoxId
                    ? `Hücre (${activeTableCell.row + 1},${activeTableCell.col + 1})`
                    : 'Kutu Rengi'}
                </span>
                <div className="flex items-center gap-1">
                  {[
                    { color: 'transparent', label: 'Şeffaf Kutu' },
                    { color: '#fef08a', label: 'Pastel Sarı' },
                    { color: '#bbf7d0', label: 'Pastel Yeşil' },
                    { color: '#bae6fd', label: 'Pastel Mavi' },
                    { color: '#fbcfe8', label: 'Pastel Pembe' },
                    { color: '#fed7aa', label: 'Pastel Turuncu' }
                  ].map((hl) => (
                    <button
                      key={hl.color}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); applyTextFormat('boxBgColor', hl.color); }}
                      style={{ backgroundColor: hl.color === 'transparent' ? '#ffffff' : hl.color }}
                      className={`w-4 h-4 rounded-full border transition-transform cursor-pointer hover:scale-125 text-[9px] flex items-center justify-center text-slate-500 ${
                        currentBoxBgColor === hl.color ? 'ring-2 ring-sky-400 border-white scale-110' : 'border-black/15'
                      }`}
                      title={`Kutu Rengi: ${hl.label}`}
                    >
                      {hl.color === 'transparent' ? '×' : ''}
                    </button>
                  ))}

                  {/* Açılır Kutu Rengi Paleti Düğmesi */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setBgPaletteOpen((prev) => !prev);
                      setColorPaletteOpen(false);
                    }}
                    className="ml-0.5 h-6 px-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold flex items-center gap-1 transition"
                    title="Kutu Rengi Paleti"
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-slate-300"
                      style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
                    />
                    <span>Palet ▾</span>
                  </button>
                </div>

                {/* Açılır Kutu Rengi Paleti Penceresi */}
                {bgPaletteOpen && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    className="fixed left-4 top-24 w-64 p-3 bg-white border border-slate-200 rounded-xl shadow-2xl z-[60] flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-[11px] font-bold text-slate-700">Kutu Rengi Paleti</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyTextFormat('boxBgColor', 'transparent');
                            setBgPaletteOpen(false);
                          }}
                          className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
                        >
                          Şeffaf Yap
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setBgPaletteOpen(false);
                          }}
                          className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* 80 Tonluk Kutu Rengi Matrisi */}
                    <div className="grid grid-cols-10 gap-1">
                      {[
                        '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#1e293b', '#000000',
                        '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
                        '#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
                        '#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12',
                        '#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
                        '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
                        '#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87',
                        '#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'
                      ].map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyTextFormat('boxBgColor', hex);
                            setBgPaletteOpen(false);
                          }}
                          style={{ backgroundColor: hex }}
                          className={`w-4 h-4 rounded-xs border transition-transform hover:scale-125 ${
                            currentBoxBgColor.toLowerCase() === hex ? 'ring-2 ring-sky-500 border-white' : 'border-slate-300/70'
                          }`}
                          title={hex.toUpperCase()}
                        />
                      ))}
                    </div>

                    {/* Özel Kutu Rengi Çarkı Seçici */}
                    <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-medium text-slate-500">Özel Ton Seç:</span>
                      <label className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer transition">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-slate-300"
                          style={{ backgroundColor: currentBoxBgColor.startsWith('#') ? currentBoxBgColor : '#fef08a' }}
                        />
                        <span>Renk Çarkı</span>
                        <input
                          type="color"
                          value={currentBoxBgColor.startsWith('#') ? currentBoxBgColor : '#fef08a'}
                          onChange={(e) => applyTextFormat('boxBgColor', e.target.value)}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Yazı Rengi Bölümü ve Temizle */}
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 flex items-center justify-between gap-1 bg-slate-50 px-2 py-1 rounded-md border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">Yazı Rengi</span>
                  <div className="flex items-center gap-1">
                    {[
                      { color: '#0f172a', label: 'Gece Siyahı' },
                      { color: '#dc2626', label: 'Kırmızı' },
                      { color: '#ea580c', label: 'Turuncu' },
                      { color: '#16a34a', label: 'Zümrüt Yeşili' },
                      { color: '#2563eb', label: 'Kraliyet Mavisi' },
                      { color: '#7c3aed', label: 'Mor' }
                    ].map((swatch) => (
                      <button
                        key={swatch.color}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); applyTextFormat('foreColor', swatch.color); }}
                        style={{ backgroundColor: swatch.color }}
                        className={`w-4 h-4 rounded-full border transition-transform cursor-pointer hover:scale-125 ${
                          currentTextColor === swatch.color ? 'ring-2 ring-sky-400 border-white scale-110' : 'border-black/15'
                        }`}
                        title={`Yazı Rengi: ${swatch.label}`}
                      />
                    ))}

                    {/* Açılır Tam Renk Paleti Düğmesi */}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setColorPaletteOpen((prev) => !prev);
                        setBgPaletteOpen(false);
                      }}
                      className="ml-0.5 h-6 px-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-bold flex items-center gap-1 transition"
                      title="Yazı Rengi Paleti"
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-slate-300"
                        style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
                      />
                      <span>Palet ▾</span>
                    </button>
                  </div>

                  {/* Açılır Word Renk Paleti Penceresi */}
                  {colorPaletteOpen && (
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      className="fixed left-4 top-24 w-64 p-3 bg-white border border-slate-200 rounded-xl shadow-2xl z-[60] flex flex-col gap-2.5"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                        <span className="text-[11px] font-bold text-slate-700">Yazı Rengi Paleti</span>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setColorPaletteOpen(false);
                          }}
                          className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Tema & Ton Matrisi (80 Renk) */}
                      <div className="grid grid-cols-10 gap-1">
                        {[
                          '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#1e293b', '#000000',
                          '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
                          '#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
                          '#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12',
                          '#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
                          '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
                          '#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87',
                          '#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'
                        ].map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applyTextFormat('foreColor', hex);
                              setColorPaletteOpen(false);
                            }}
                            style={{ backgroundColor: hex }}
                            className={`w-4 h-4 rounded-xs border transition-transform hover:scale-125 ${
                              currentTextColor.toLowerCase() === hex ? 'ring-2 ring-sky-500 border-white' : 'border-slate-300/70'
                            }`}
                            title={hex.toUpperCase()}
                          />
                        ))}
                      </div>

                      {/* Özel Renk Çarkı Seçici */}
                      <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-500">Özel Ton Seç:</span>
                        <label className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer transition">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-slate-300"
                            style={{ backgroundColor: currentTextColor.startsWith('#') ? currentTextColor : '#1e293b' }}
                          />
                          <span>Renk Çarkı</span>
                          <input
                            type="color"
                            value={currentTextColor.startsWith('#') ? currentTextColor : '#1e293b'}
                            onChange={(e) => applyTextFormat('foreColor', e.target.value)}
                            className="sr-only"
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          id="agenda-book"
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: pageBgColors[currentLeftPage] || (isCoverView ? '#f5efe6' : '#fdfbf7'),
            '--page-edge-1': pageBgColors[isCoverView ? 0 : currentRightPage] || pageBgColors[currentLeftPage] || (isCoverView ? '#f5efe6' : '#fdfbf7'),
            '--page-edge-2': `color-mix(in srgb, ${pageBgColors[isCoverView ? 0 : currentRightPage] || pageBgColors[currentLeftPage] || (isCoverView ? '#f5efe6' : '#fdfbf7')} 84%, #1e293b)`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
              const activeContent = e.target.closest('.agenda-textbox-content');
              if (activeContent) {
                // Yazı düzenlenirken yalnızca kutu içindeki metin silinsin, kutunun kendisi asla silinmesin
                e.stopPropagation();
                return;
              }
              if (e.key === 'Delete') {
                const selectedBlock = document.activeElement?.closest('.agenda-block-wrapper');
                if (selectedBlock) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (activeTextBoxElementRef.current === selectedBlock) {
                    activeTextBoxElementRef.current = null;
                    savedSelectionRef.current = null;
                    setActiveTextBoxId(null);
                  }
                  selectedBlock.remove();
                  if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
                  if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
                  return;
                }
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              const textboxContent = e.target.closest('.agenda-textbox-content');
              const pageEditor = e.target.closest('[contenteditable="true"]');
              if (textboxContent || pageEditor) {
                const sel = window.getSelection();
                const inList =
                  sel &&
                  sel.anchorNode &&
                  (sel.anchorNode.parentElement?.closest('li') ||
                    (sel.anchorNode.nodeType === 1 && (sel.anchorNode as Element).closest('li')));
                if (!inList) {
                  e.preventDefault();
                  e.stopPropagation();
                  document.execCommand('insertLineBreak');
                  if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
                  if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
                }
              }
            }
          }}
          onMouseDown={(e) => handleEditorMouseDownOrTouch(e, null, null)}
          onTouchStart={(e) => handleEditorMouseDownOrTouch(e, null, null)}
          onDoubleClick={(e) => {
            const rotateHandle = e.target.closest('.rotate-handle');
            if (rotateHandle) {
              e.preventDefault();
              e.stopPropagation();
              const targetBox = rotateHandle.closest('.agenda-block-wrapper');
              if (targetBox) {
                targetBox.style.transform = 'rotate(0deg)';
                targetBox.setAttribute('data-rotation', '0');
                const badge = targetBox.querySelector('.rotate-angle-badge');
                if (badge) {
                  badge.textContent = '0°';
                  badge.style.opacity = '0';
                }
                if (leftEditorRef.current) saveContent(currentLeftPage, leftEditorRef.current.innerHTML);
                if (!isCoverView && rightEditorRef.current) saveContent(currentRightPage, rightEditorRef.current.innerHTML);
              }
            }
          }}
          className={`relative w-full h-full max-h-[680px] bg-white rounded-xl book-on-desk-shadow border border-amber-950/30 flex transition-all duration-300 ${
            isCoverView ? 'max-w-[480px] aspect-[148/210]' : 'max-w-[960px] aspect-[296/210]'
          }`}
        >
          {/* Kitabın Sağ Tarafında Masada Duran Tıklanabilir Dolma Kalem (Aralarında Masa Boşluğu Var) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPenMode((prev) => !prev);
              setActiveTextBoxId(null);
            }}
            title={penMode ? 'Kalemi Masaya Bırak (Çizim Modunu Kapat)' : 'Kalemi Al ve Ajandaya Çiz'}
            className={`group hidden md:flex flex-col items-center absolute top-1/2 -right-20 z-30 select-none cursor-pointer transition-all duration-300 focus:outline-none ${
              penMode
                ? '-translate-y-[54%] scale-105 drop-shadow-[-14px_24px_18px_rgba(2,132,199,0.55)]'
                : '-translate-y-1/2 hover:-translate-y-[52%] hover:scale-[1.03] drop-shadow-[-8px_16px_14px_rgba(18,9,3,0.72)]'
            }`}
          >
            {/* Aktif / İpucu Etiketi */}
            <span
              className={`mb-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide shadow transition-all ${
                penMode
                  ? 'bg-sky-500 text-white opacity-100'
                  : 'bg-slate-900/85 text-amber-100 opacity-0 group-hover:opacity-100'
              }`}
            >
              {penMode ? 'Çizim Aktif' : 'Kalemi Al'}
            </span>
            {/* Kalem Tepesi */}
            <div className="w-3.5 h-5 rounded-t-full bg-gradient-to-r from-amber-300 via-amber-500 to-amber-700" />
            {/* Kalem Kapağı */}
            <div className="relative w-4 h-36 rounded-t-sm bg-gradient-to-r from-slate-900 via-slate-700 to-slate-950 border-x border-slate-600/40">
              {/* Altın Klips */}
              <div className="absolute -right-1 top-3 w-1 h-28 rounded-full bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 shadow" />
            </div>
            {/* Kalem Gövdesi */}
            <div className="w-4 h-48 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950 border-x border-slate-600/40 flex flex-col justify-between items-center py-2">
              <div className="w-full h-[2px] bg-gradient-to-r from-amber-300 via-amber-500 to-amber-700" />
              <div className="w-full h-[2px] bg-gradient-to-r from-amber-300 via-amber-500 to-amber-700" />
            </div>
            {/* Altın Dolma Kalem Ucu (Nib) */}
            <div
              className="w-3.5 h-6 bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700"
              style={{ clipPath: 'polygon(15% 0%, 85% 0%, 100% 35%, 50% 100%, 0% 35%)' }}
            />
          </button>

          {/* KALEM ÇİZİM MODU AKTİFKEN SAĞ TARAFTA KALEMİN YANINDA AÇILAN ÇİZİM ÖZELLİKLERİ ARAÇ ÇUBUĞU (KAĞIDIN ÜSTÜNÜ KAPATMAZ) */}
          {penMode && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="fixed bottom-16 md:bottom-auto md:top-1/2 md:-translate-y-1/2 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-28 z-50 flex flex-wrap md:flex-col items-center md:items-stretch gap-2 p-2.5 bg-slate-900/95 text-white backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl text-xs max-w-[95vw] md:w-44"
            >
              {/* Başlık ve Kapatma */}
              <div className="hidden md:flex items-center justify-between pb-1.5 border-b border-slate-700/80">
                <span className="text-[11px] font-bold text-sky-400 tracking-wide">Kalem Ayarları</span>
                <button
                  type="button"
                  onClick={() => setPenMode(false)}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                  title="Kalemi Masaya Bırak"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Kalem / Düz Çizgi / Fosforlu / Silgi Seçimi */}
              <div className="flex md:grid md:grid-cols-2 items-center gap-1 bg-slate-800 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPenTool('pen')}
                  className={`px-2 py-1.5 rounded-lg font-semibold text-center transition ${
                    penTool === 'pen' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Kalem
                </button>
                <button
                  type="button"
                  onClick={() => setPenTool('line')}
                  className={`px-2 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 transition ${
                    penTool === 'line' ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
                  }`}
                  title="Bir noktadan diğerine düz çizgi çek (Shift ile 45°/90° hizalı)"
                >
                  <span className="inline-block w-3 h-[2px] bg-current -rotate-45 rounded-full shrink-0" />
                  <span>Çizgi</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPenTool('highlighter')}
                  className={`px-2 py-1.5 rounded-lg font-semibold text-center transition ${
                    penTool === 'highlighter' ? 'bg-amber-400 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Fosforlu
                </button>
                <button
                  type="button"
                  onClick={() => setPenTool('eraser')}
                  className={`px-2 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 transition ${
                    penTool === 'eraser' ? 'bg-rose-500 text-white shadow' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Eraser className="w-3 h-3 shrink-0" />
                  <span>Silgi</span>
                </button>
              </div>

              <div className="w-[1px] h-5 md:w-full md:h-[1px] bg-slate-700" />

              {/* Renk Seçimi */}
              <div className="flex md:flex-col items-center md:items-stretch gap-1.5">
                <span className="text-[11px] font-semibold text-slate-400">Renk:</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { color: '#1e293b', label: 'Siyah Mürekkep' },
                    { color: '#1d4ed8', label: 'Dolma Kalem Mavisi' },
                    { color: '#dc2626', label: 'Kırmızı Mürekkep' },
                    { color: '#15803d', label: 'Zümrüt Yeşili' },
                    { color: '#7e22ce', label: 'Mor Mürekkep' },
                    { color: '#facc15', label: 'Sarı Fosforlu' }
                  ].map((ink) => (
                    <button
                      key={ink.color}
                      type="button"
                      onClick={() => {
                        setPenColor(ink.color);
                        if (penTool === 'eraser') setPenTool('pen');
                      }}
                      style={{ backgroundColor: ink.color }}
                      title={ink.label}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                        penColor === ink.color && penTool !== 'eraser'
                          ? 'border-white scale-115 ring-2 ring-sky-400'
                          : 'border-slate-600'
                      }`}
                    />
                  ))}
                  <label
                    title="Özel Renk Seç"
                    className="w-5 h-5 rounded-full border border-slate-500 cursor-pointer overflow-hidden flex items-center justify-center"
                    style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
                  >
                    <input
                      type="color"
                      value={penColor}
                      onChange={(e) => {
                        setPenColor(e.target.value);
                        if (penTool === 'eraser') setPenTool('pen');
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <div className="w-[1px] h-5 md:w-full md:h-[1px] bg-slate-700" />

              {/* Boyut (Uç Kalınlığı) Seçimi */}
              <div className="flex md:flex-col items-center md:items-stretch gap-1.5">
                <span className="text-[11px] font-semibold text-slate-400">Kalınlık:</span>
                <div className="flex items-center justify-between gap-1">
                  {[
                    { size: 2, label: 'İnce (2px)' },
                    { size: 4, label: 'Orta (4px)' },
                    { size: 8, label: 'Kalın (8px)' },
                    { size: 14, label: 'Çok Kalın (14px)' }
                  ].map((nib) => (
                    <button
                      key={nib.size}
                      type="button"
                      onClick={() => setPenSize(nib.size)}
                      title={nib.label}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
                        penSize === nib.size ? 'bg-slate-700 ring-1 ring-sky-400' : 'hover:bg-slate-800'
                      }`}
                    >
                      <span
                        style={{ width: `${Math.min(16, nib.size + 3)}px`, height: `${Math.min(16, nib.size + 3)}px` }}
                        className="rounded-full bg-white block"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-[1px] h-5 md:w-full md:h-[1px] bg-slate-700" />

              {/* Aktif Sayfa Çizimini Temizle */}
              <button
                type="button"
                onClick={() => {
                  const targetPage = isCoverView
                    ? 0
                    : activeEditorTarget === 'left'
                    ? currentLeftPage
                    : currentRightPage;
                  clearPageDrawing(targetPage);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 font-semibold text-center transition"
                title="Seçili Sayfadaki Tüm Çizimleri Temizle"
              >
                Sayfayı Temizle
              </button>

              {/* Mobil Kapatma Düğmesi */}
              <button
                type="button"
                onClick={() => setPenMode(false)}
                className="md:hidden p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                title="Kalemi Masaya Bırak"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* İç Sayfa Katmanı (Köşe Yuvarlaklıklarını Korur) */}
          <div
            style={{
              backgroundColor: pageBgColors[currentLeftPage] || (isCoverView ? '#f5efe6' : '#fdfbf7')
            }}
            className="relative w-full h-full flex overflow-visible rounded-xl"
          >
          {/* BANT ÇEKME MODU AKTİFKEN ÜST BİLGİ ÇUBUĞU VE ETKİLEŞİMLİ ÇİZİM KATMANI */}
          {selectedTapeImage && (
            <>
              <div
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-3.5 py-2 bg-slate-900/95 text-white backdrop-blur-md border border-emerald-500/50 rounded-2xl shadow-2xl text-xs max-w-[95vw]"
              >
                <img
                  src={selectedTapeImage.src}
                  alt={selectedTapeImage.label}
                  className="w-7 h-7 rounded-lg object-contain bg-white p-0.5 border border-slate-700 shrink-0"
                />
                <span className="font-semibold text-emerald-300">
                  Bant Modu: Sol tıka basılı tutup sürükleyerek bant çekin
                </span>
                <button
                  type="button"
                  onClick={() => {
                    placeImageOnActivePage(selectedTapeImage.src);
                    setSelectedTapeImage(null);
                    setTapeDragPoints([]);
                    tapeDragRef.current = [];
                    lastTapeStampRef.current = null;
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition shrink-0"
                >
                  + Tek Resim Ekle
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTapeImage(null);
                    setTapeDragPoints([]);
                    tapeDragRef.current = [];
                    lastTapeStampRef.current = null;
                  }}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                  title="Bant Modundan Çık (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Sayfa Üzerinde Sol Tık Basılı Tutup Sağa/Sola Serbest Kaydırma Katmanı */}
              <div
                onMouseDown={handleTapeDrawMouseDown}
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-0 z-30 cursor-crosshair"
                title="Sol tıka basılı tutup sağa, sola veya kıvrımlı kaydırarak bant şeridi ekleyin"
              />

              {/* Sürüklerken Sağa/Sola Kıvrılan Canlı Bant Önizlemesi */}
              {tapeDragPoints.length > 1 && (() => {
                const previewW = selectedTapeImage.width || 128;
                const previewH = selectedTapeImage.height || previewW;
                return (
                  <div className="pointer-events-none absolute inset-0 z-40">
                    {tapeDragPoints.slice(1).map((pt, idx) => (
                      <div
                        key={idx}
                        style={{
                          left: `${pt.x - previewW / 2}px`,
                          top: `${pt.y - previewH / 2}px`,
                          width: `${previewW}px`,
                          height: `${previewH}px`,
                          transform: `rotate(${pt.angle || 0}deg)`,
                          transformOrigin: 'center center',
                          backgroundImage: `url('${selectedTapeImage.src}')`,
                          backgroundSize: 'contain',
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: 'center',
                          opacity: 0.9
                        }}
                        className="absolute drop-shadow-xs"
                      />
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {/* POWERPOINT TARZI AKILLI HİZALAMA & EŞİT MESAFE KILAVUZ ÇİZGİLERİ */}
          {(alignmentGuides.vertical.length > 0 ||
            alignmentGuides.horizontal.length > 0 ||
            alignmentGuides.spacing.length > 0) && (
            <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
              {/* Dikey Hizalama Çizgileri */}
              {alignmentGuides.vertical.map((line, idx) => (
                <div
                  key={`v_${idx}`}
                  style={{
                    left: `${line.x}px`,
                    top: `${line.y1}px`,
                    height: `${Math.max(12, line.y2 - line.y1)}px`
                  }}
                  className="absolute w-0 border-l-[1.5px] border-dashed border-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.45)]"
                />
              ))}

              {/* Yatay Hizalama Çizgileri */}
              {alignmentGuides.horizontal.map((line, idx) => (
                <div
                  key={`h_${idx}`}
                  style={{
                    top: `${line.y}px`,
                    left: `${line.x1}px`,
                    width: `${Math.max(12, line.x2 - line.x1)}px`
                  }}
                  className="absolute h-0 border-t-[1.5px] border-dashed border-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.45)]"
                />
              ))}

              {/* Eşit Aralık (Orantılı Mesafe) Göstergeleri */}
              {alignmentGuides.spacing.map((sp, idx) =>
                sp.orientation === 'h' ? (
                  <div
                    key={`sp_h_${idx}`}
                    style={{
                      left: `${sp.x1}px`,
                      top: `${sp.y}px`,
                      width: `${Math.max(4, sp.x2 - sp.x1)}px`
                    }}
                    className="absolute -translate-y-1/2 flex items-center justify-center"
                  >
                    <div className="w-full h-[1.5px] bg-sky-500 relative flex items-center justify-between">
                      <span className="w-[1.5px] h-2.5 bg-sky-500 block" />
                      <span className="px-1 py-0.2 rounded bg-sky-600 text-white text-[9px] font-bold shadow-xs">
                        {sp.dist}px
                      </span>
                      <span className="w-[1.5px] h-2.5 bg-sky-500 block" />
                    </div>
                  </div>
                ) : (
                  <div
                    key={`sp_v_${idx}`}
                    style={{
                      left: `${sp.x}px`,
                      top: `${sp.y1}px`,
                      height: `${Math.max(4, sp.y2 - sp.y1)}px`
                    }}
                    className="absolute -translate-x-1/2 flex flex-col items-center justify-center"
                  >
                    <div className="h-full w-[1.5px] bg-sky-500 relative flex flex-col items-center justify-between">
                      <span className="h-[1.5px] w-2.5 bg-sky-500 block" />
                      <span className="px-1 py-0.2 rounded bg-sky-600 text-white text-[9px] font-bold shadow-xs">
                        {sp.dist}px
                      </span>
                      <span className="h-[1.5px] w-2.5 bg-sky-500 block" />
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* SOL DIŞ KENAR TUTMA / KIVIRMA BÖLGESİ */}
          <div
            onMouseDown={(e) => startEdgeCurl(e, 'prev')}
            onTouchStart={(e) => startEdgeCurl(e, 'prev')}
            className="absolute left-0 top-0 bottom-0 w-12 z-30 cursor-grab active:cursor-grabbing group"
            title={currentLeftPage > 0 ? 'Önceki sayfaya çevirmek için sürükleyin' : ''}
          >
            {currentLeftPage > 0 && (
              <div className="w-full h-full bg-gradient-to-r from-slate-900/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>

          {/* SAĞ DIŞ KENAR TUTMA / KIVIRMA BÖLGESİ */}
          <div
            onMouseDown={(e) => startEdgeCurl(e, 'next')}
            onTouchStart={(e) => startEdgeCurl(e, 'next')}
            className="absolute right-0 top-0 bottom-0 w-12 z-30 cursor-grab active:cursor-grabbing group"
            title={isCoverView || currentRightPage < TOTAL_PAGES ? 'Sonraki sayfaya çevirmek için sürükleyin' : ''}
          >
            {(isCoverView || currentRightPage < TOTAL_PAGES) && (
              <div className="w-full h-full bg-gradient-to-l from-slate-900/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>

          {/* SOL / KAPAK SAYFASI */}
          <section 
            style={{
              backgroundColor: pageBgColors[currentLeftPage] || (isCoverView ? '#f5efe6' : '#fdfbf7'),
              ...(pageBgImages[currentLeftPage]
                ? (() => {
                    const cfg = pageBgImageConfigs[currentLeftPage] || { scale: 100, posX: 50, posY: 50, repeat: 'no-repeat' };
                    const bgSizeVal = cfg.repeat === 'no-repeat' ? 'cover' : `${cfg.scale}%`;
                    return {
                      backgroundImage: `url(${pageBgImages[currentLeftPage]})`,
                      backgroundSize: bgSizeVal,
                      backgroundPosition: `${cfg.posX}% ${cfg.posY}%`,
                      backgroundRepeat: cfg.repeat
                    };
                  })()
                : {})
            }}
            className={`relative ${isCoverView ? 'w-full rounded-xl' : 'w-1/2 rounded-l-xl'} h-full flex flex-col transition-colors duration-200 notebook-left-edge ${
              pageBgImages[currentLeftPage]
                ? ''
                : (pageRulings[currentLeftPage] || 'plain') === 'lined'
                ? 'notebook-page-lined'
                : (pageRulings[currentLeftPage] || 'plain') === 'grid'
                ? 'notebook-page-grid'
                : (pageRulings[currentLeftPage] || 'plain') === 'dotted'
                ? 'notebook-page-dotted'
                : 'notebook-page-surface'
            }`}
          >
            {/* Kapak Sayfası Sol Cilt Sırtı Gölgesi */}
            {isCoverView && (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 w-10 z-20"
                style={{
                  background:
                    'linear-gradient(to right, rgba(15,23,42,0.22) 0%, rgba(15,23,42,0.08) 35%, rgba(15,23,42,0) 100%)'
                }}
              />
            )}
            <div
              ref={leftEditorRef}
              contentEditable
              suppressContentEditableWarning
              onClick={handlePageEmptyAreaClick}
              onFocus={() => setActiveEditorTarget('left')}
              onPaste={(e) => {
                if (e.target.closest('.agenda-textbox-content')) {
                  e.preventDefault();
                  const plainText = e.clipboardData.getData('text/plain');
                  document.execCommand('insertText', false, plainText);
                  saveContent(currentLeftPage, e.currentTarget.innerHTML);
                }
              }}
              onInput={(e) => {
                saveContent(currentLeftPage, e.currentTarget.innerHTML);
              }}
              onBeforeInput={(e) => {
                if (e.target === e.currentTarget && (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward')) {
                  const sel = window.getSelection();
                  if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const container = range.commonAncestorContainer;
                    const el = container.nodeType === 1 ? container as Element : container.parentElement;
                    if (el && el.closest('.agenda-block-wrapper') && !el.closest('.agenda-textbox-content')) {
                      e.preventDefault();
                    }
                  }
                }
              }}
              className="flex-1 w-full h-full px-8 sm:px-12 pt-10 pb-12 outline-none overflow-visible text-slate-800 text-sm sm:text-base leading-relaxed select-text"
            />
            {renderManagedPageItems(currentLeftPage)}
            <canvas
              ref={leftCanvasRef}
              onMouseDown={(e) => handleCanvasDrawStart(e, 'left')}
              onMouseMove={(e) => handleCanvasDrawMove(e, 'left')}
              onMouseUp={handleCanvasDrawEnd}
              onMouseLeave={handleCanvasDrawEnd}
              onTouchStart={(e) => handleCanvasDrawStart(e, 'left')}
              onTouchMove={(e) => handleCanvasDrawMove(e, 'left')}
              onTouchEnd={handleCanvasDrawEnd}
              className={`absolute inset-0 w-full h-full z-20 ${
                penMode ? 'pointer-events-auto cursor-crosshair touch-none' : 'pointer-events-none'
              }`}
            />
          </section>

          {/* ORTA CİLT / DİKİŞ GÖLGESİ VE SAĞ SAYFA */}
          {!isCoverView && (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-28 z-20 flex items-stretch">
                <div
                  className="w-1/2 h-full"
                  style={{
                    background:
                      'linear-gradient(to right, rgba(15,23,42,0) 0%, rgba(15,23,42,0.035) 55%, rgba(15,23,42,0.16) 96%, rgba(15,23,42,0.28) 100%)'
                  }}
                />
                <div className="w-[1.5px] h-full bg-slate-900/25 shadow-[0_0_8px_rgba(15,23,42,0.2)]" />
                <div
                  className="w-1/2 h-full"
                  style={{
                    background:
                      'linear-gradient(to left, rgba(15,23,42,0) 0%, rgba(15,23,42,0.035) 55%, rgba(15,23,42,0.16) 96%, rgba(15,23,42,0.28) 100%)'
                  }}
                />
              </div>

              {/* SAĞ SAYFA */}
              <section
                style={{
                  backgroundColor: pageBgColors[currentRightPage] || '#fdfbf7',
                  ...(pageBgImages[currentRightPage]
                    ? (() => {
                        const cfg = pageBgImageConfigs[currentRightPage] || { scale: 100, posX: 50, posY: 50, repeat: 'no-repeat' };
                        const bgSizeVal = cfg.repeat === 'no-repeat' ? 'cover' : `${cfg.scale}%`;
                        return {
                          backgroundImage: `url(${pageBgImages[currentRightPage]})`,
                          backgroundSize: bgSizeVal,
                          backgroundPosition: `${cfg.posX}% ${cfg.posY}%`,
                          backgroundRepeat: cfg.repeat
                        };
                      })()
                    : {})
                }}
                className={`relative w-1/2 h-full rounded-r-xl flex flex-col transition-colors duration-200 notebook-right-edge ${
                  pageBgImages[currentRightPage]
                    ? ''
                    : (pageRulings[currentRightPage] || 'plain') === 'lined'
                    ? 'notebook-page-lined'
                    : (pageRulings[currentRightPage] || 'plain') === 'grid'
                    ? 'notebook-page-grid'
                    : (pageRulings[currentRightPage] || 'plain') === 'dotted'
                    ? 'notebook-page-dotted'
                    : 'notebook-page-surface'
                }`}
              >
                <div
                  ref={rightEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onClick={handlePageEmptyAreaClick}
                  onFocus={() => setActiveEditorTarget('right')}
                  onPaste={(e) => {
                    if (e.target.closest('.agenda-textbox-content')) {
                      e.preventDefault();
                      const plainText = e.clipboardData.getData('text/plain');
                      document.execCommand('insertText', false, plainText);
                      saveContent(currentRightPage, e.currentTarget.innerHTML);
                    }
                  }}
                  onInput={(e) => saveContent(currentRightPage, e.currentTarget.innerHTML)}
                  onBeforeInput={(e) => {
                    if (e.target === e.currentTarget && (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward')) {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        const container = range.commonAncestorContainer;
                        const el = container.nodeType === 1 ? container as Element : container.parentElement;
                        if (el && el.closest('.agenda-block-wrapper') && !el.closest('.agenda-textbox-content')) {
                          e.preventDefault();
                        }
                      }
                    }
                  }}
                  className="flex-1 w-full h-full px-8 sm:px-12 pt-10 pb-12 outline-none overflow-visible text-slate-800 text-sm sm:text-base leading-relaxed select-text"
                />
                {renderManagedPageItems(currentRightPage)}
                <canvas
                  ref={rightCanvasRef}
                  onMouseDown={(e) => handleCanvasDrawStart(e, 'right')}
                  onMouseMove={(e) => handleCanvasDrawMove(e, 'right')}
                  onMouseUp={handleCanvasDrawEnd}
                  onMouseLeave={handleCanvasDrawEnd}
                  onTouchStart={(e) => handleCanvasDrawStart(e, 'right')}
                  onTouchMove={(e) => handleCanvasDrawMove(e, 'right')}
                  onTouchEnd={handleCanvasDrawEnd}
                  className={`absolute inset-0 w-full h-full z-20 ${
                    penMode ? 'pointer-events-auto cursor-crosshair touch-none' : 'pointer-events-none'
                  }`}
                />
              </section>
            </>
          )}

          {/* 3D SAYFA ÇEVİRME / KIVRILMA KATMANI (Gerçekçi Ön-Arka Kağıt Yaprağı ve Dinamik Işık-Gölge) */}
          {pageTurn && (() => {
            const p = pageTurn.progress;
            const sineArch = Math.sin(p * Math.PI); // 0 -> 1 -> 0 kâğıt kalkma kavisi
            const tilt = (pageTurn.curlTilt || 0) * sineArch;
            const angle =
              pageTurn.direction === 'next' ? -p * 180 : p * 180;
            const activeFrontBg =
              pageTurn.direction === 'next'
                ? pageBgColors[isCoverView ? 0 : currentRightPage] || (isCoverView ? '#f5efe6' : '#fdfbf7')
                : pageBgColors[currentLeftPage] || '#fdfbf7';
            const activeBackBg =
              pageTurn.direction === 'next'
                ? pageBgColors[isCoverView ? 1 : Math.min(TOTAL_PAGES, currentRightPage + 1)] || '#fdfbf7'
                : pageBgColors[Math.max(0, currentLeftPage - 1)] || (currentLeftPage === 1 ? '#f5efe6' : '#fdfbf7');

            return (
              <>
                {/* Alt Sayfa Üzerine Düşen Yumuşak Hareketli Gölge */}
                <div
                  className="pointer-events-none absolute inset-0 z-30"
                  style={{
                    background:
                      pageTurn.direction === 'next'
                        ? `radial-gradient(circle at ${100 - p * 100}% 50%, rgba(15, 23, 42, ${0.16 * sineArch}) 0%, rgba(15, 23, 42, ${0.06 * sineArch}) 35%, transparent 70%)`
                        : `radial-gradient(circle at ${p * 100}% 50%, rgba(15, 23, 42, ${0.16 * sineArch}) 0%, rgba(15, 23, 42, ${0.06 * sineArch}) 35%, transparent 70%)`
                  }}
                />

                {/* Çevrilen 3D Kâğıt Yaprağı */}
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-40"
                  style={{
                    width: isCoverView ? '100%' : '50%',
                    left: isCoverView ? '0%' : pageTurn.direction === 'next' ? '50%' : '0%',
                    transformOrigin: isCoverView
                      ? 'left center'
                      : pageTurn.direction === 'next'
                      ? 'left center'
                      : 'right center',
                    transformStyle: 'preserve-3d',
                    transform: `translateZ(${sineArch * 18}px) rotateY(${angle}deg) skewY(${tilt}deg) scaleX(${1 - sineArch * 0.025})`,
                    boxShadow:
                      pageTurn.direction === 'next'
                        ? `${-18 * sineArch}px ${8 * sineArch}px ${38 * sineArch + 4}px rgba(15, 23, 42, ${0.22 * sineArch})`
                        : `${18 * sineArch}px ${8 * sineArch}px ${38 * sineArch + 4}px rgba(15, 23, 42, ${0.22 * sineArch})`
                  }}
                >
                  {/* Kâğıdın Ön Yüzü */}
                  <div
                    className="absolute inset-0 notebook-page-surface overflow-hidden"
                    style={{
                      backgroundColor: activeFrontBg,
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      borderRadius:
                        pageTurn.direction === 'next'
                          ? '0 12px 12px 0'
                          : '12px 0 0 12px'
                    }}
                  >
                    {/* Kâğıt Bükülme Işık Parlaması ve Cilt Gölgesi */}
                    <div
                      className="w-full h-full"
                      style={{
                        background:
                          pageTurn.direction === 'next'
                            ? `linear-gradient(to right, rgba(15,23,42,${0.18 * (1 - p)}) 0%, rgba(255,255,255,${0.32 * sineArch}) 32%, rgba(15,23,42,${0.07 * sineArch}) 82%, rgba(15,23,42,${0.14 * sineArch}) 100%)`
                            : `linear-gradient(to left, rgba(15,23,42,${0.18 * (1 - p)}) 0%, rgba(255,255,255,${0.32 * sineArch}) 32%, rgba(15,23,42,${0.07 * sineArch}) 82%, rgba(15,23,42,${0.14 * sineArch}) 100%)`
                      }}
                    />
                  </div>

                  {/* Kâğıdın Arka Yüzü (180° döndüğünde görünen gerçek arka sayfa yüzeyi) */}
                  <div
                    className="absolute inset-0 notebook-page-surface overflow-hidden"
                    style={{
                      backgroundColor: activeBackBg,
                      transform: 'rotateY(180deg)',
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      borderRadius:
                        pageTurn.direction === 'next'
                          ? '12px 0 0 12px'
                          : '0 12px 12px 0'
                    }}
                  >
                    <div
                      className="w-full h-full"
                      style={{
                        background:
                          pageTurn.direction === 'next'
                            ? `linear-gradient(to left, rgba(15,23,42,${0.16 * p}) 0%, rgba(255,255,255,${0.28 * sineArch}) 38%, rgba(15,23,42,${0.06 * sineArch}) 88%, rgba(15,23,42,${0.12 * sineArch}) 100%)`
                            : `linear-gradient(to right, rgba(15,23,42,${0.16 * p}) 0%, rgba(255,255,255,${0.28 * sineArch}) 38%, rgba(15,23,42,${0.06 * sineArch}) 88%, rgba(15,23,42,${0.12 * sineArch}) 100%)`
                      }}
                    />
                  </div>
                </div>
              </>
            );
          })()}
          </div>
        </div>

        {/* MASA ÜZERİNDE DURAN SERBEST GÖRSELLER / ÇIKARTMALAR (AJANDA DIŞINDA MASADA DA TUTULABİLİR) */}
        {deskItems.map((item) => {
          const isSelected = selectedDeskItemId === item.id;
          return (
            <div
              key={item.id}
              data-desk-item="true"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedDeskItemId(item.id);
              }}
              onMouseDown={(e) => {
                if (e.target.closest('button') || e.target.closest('[data-desk-control="true"]')) return;
                e.preventDefault();
                e.stopPropagation();
                setSelectedDeskItemId(item.id);
                deskItemDragRef.current = {
                  mode: 'move',
                  id: item.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialX: item.x,
                  initialY: item.y
                };
              }}
              onTouchStart={(e) => {
                if (e.target.closest('button') || e.target.closest('[data-desk-control="true"]')) return;
                e.stopPropagation();
                setSelectedDeskItemId(item.id);
                const t = e.touches[0];
                deskItemDragRef.current = {
                  mode: 'move',
                  id: item.id,
                  startX: t.clientX,
                  startY: t.clientY,
                  initialX: item.x,
                  initialY: item.y
                };
              }}
              style={{
                left: `${item.x}px`,
                top: `${item.y}px`,
                width: `${item.width}px`,
                height: `${item.height}px`,
                transform: `rotate(${item.angle || 0}deg)`,
                transformOrigin: 'center center'
              }}
              className={`fixed z-30 cursor-grab active:cursor-grabbing select-none rounded-xl transition-shadow ${
                isSelected ? 'ring-2 ring-sky-400 shadow-2xl' : 'drop-shadow-[0_12px_18px_rgba(18,9,3,0.55)]'
              }`}
            >
              {isSelected && (
                <>
                  {/* 360° Döndürme Tutamacı */}
                  <div
                    data-desk-control="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.parentElement.getBoundingClientRect();
                      deskItemDragRef.current = {
                        mode: 'rotate',
                        id: item.id,
                        centerX: rect.left + rect.width / 2,
                        centerY: rect.top + rect.height / 2
                      };
                    }}
                    title="Döndürmek için sürükleyin"
                    className="absolute -top-9 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white text-sky-600 border-2 border-sky-600 shadow flex items-center justify-center cursor-grab z-40"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </div>

                  {/* Üst Kontrol Çubuğu: Deftere Aktar & Masadan Kaldır */}
                  <div
                    data-desk-control="true"
                    className="absolute -top-8 right-0 flex items-center gap-1 bg-slate-900/95 text-white px-1.5 py-0.5 rounded-lg shadow-lg z-40"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        placeImageOnActivePage(item.src, { width: item.width, height: item.height });
                        updateDeskItems((prev) => prev.filter((d) => d.id !== item.id));
                        setSelectedDeskItemId(null);
                      }}
                      className="px-1.5 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-[10px] font-bold transition"
                      title="Bu görseli açık sayfaya yapıştır"
                    >
                      Sayfaya Koy
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateDeskItems((prev) => prev.filter((d) => d.id !== item.id));
                        if (selectedDeskItemId === item.id) setSelectedDeskItemId(null);
                      }}
                      className="w-5 h-5 rounded bg-rose-500 hover:bg-rose-600 text-[10px] font-bold flex items-center justify-center transition"
                      title="Masadan Kaldır"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Sağ Alt Boyutlandırma Tutamacı */}
                  <div
                    data-desk-control="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deskItemDragRef.current = {
                        mode: 'resize',
                        id: item.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        initialW: item.width,
                        initialH: item.height
                      };
                    }}
                    title="Boyutlandırmak için sürükleyin"
                    className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-sky-600 border-2 border-white shadow cursor-se-resize z-40"
                  />
                </>
              )}

              <img
                src={item.src}
                alt="Masa Üstü Görseli"
                draggable="false"
                className="w-full h-full object-contain pointer-events-none rounded-lg"
              />
            </div>
          );
        })}

        {/* CETVEL ARACI (HEM MASANIN HERHANGİ BİR YERİNDE HEM DE SAYFA ÜZERİNDE SERBESTÇE DURABİLİR) */}
        {rulerVisible && (
          <div
            id="agenda-ruler"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              if (
                e.target.closest('button') ||
                e.target.closest('[data-ruler-rotate="true"]') ||
                e.target.closest('[data-ruler-resize="true"]')
              ) return;
              e.preventDefault();
              e.stopPropagation();
              rulerDragRef.current = {
                mode: 'move',
                startX: e.clientX,
                startY: e.clientY,
                initialX: rulerState.x,
                initialY: rulerState.y
              };
            }}
            onTouchStart={(e) => {
              if (
                e.target.closest('button') ||
                e.target.closest('[data-ruler-rotate="true"]') ||
                e.target.closest('[data-ruler-resize="true"]')
              ) return;
              e.stopPropagation();
              const t = e.touches[0];
              rulerDragRef.current = {
                mode: 'move',
                startX: t.clientX,
                startY: t.clientY,
                initialX: rulerState.x,
                initialY: rulerState.y
              };
            }}
            style={{
              left: `${rulerState.x}px`,
              top: `${rulerState.y}px`,
              width: `${rulerState.width || 420}px`,
              transform: `rotate(${rulerState.angle}deg)`,
              transformOrigin: 'center center'
            }}
            className="fixed z-40 h-14 rounded-lg bg-amber-100/95 backdrop-blur-xs border border-amber-700/45 shadow-[0_14px_30px_rgba(18,9,3,0.45)] cursor-grab active:cursor-grabbing select-none flex flex-col justify-between overflow-visible"
          >
            {/* Sol Kenardan Cetveli Uzatma / Kısaltma Tutamacı */}
            <div
              data-ruler-resize="true"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                rulerDragRef.current = {
                  mode: 'resize-left',
                  startX: e.clientX,
                  startY: e.clientY,
                  initialWidth: rulerState.width || 420,
                  initialX: rulerState.x,
                  initialY: rulerState.y,
                  angle: rulerState.angle
                };
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                const t = e.touches[0];
                rulerDragRef.current = {
                  mode: 'resize-left',
                  startX: t.clientX,
                  startY: t.clientY,
                  initialWidth: rulerState.width || 420,
                  initialX: rulerState.x,
                  initialY: rulerState.y,
                  angle: rulerState.angle
                };
              }}
              title="Cetveli sol kenardan uzat veya kısalt"
              className="absolute -left-2 top-1/2 -translate-y-1/2 w-3.5 h-8 rounded-full bg-amber-600 hover:bg-amber-700 border-2 border-white shadow cursor-ew-resize flex items-center justify-center z-20"
            >
              <span className="w-[1.5px] h-3.5 bg-white/90 rounded-full" />
            </div>

            {/* Sağ Kenardan Cetveli Uzatma / Kısaltma Tutamacı */}
            <div
              data-ruler-resize="true"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                rulerDragRef.current = {
                  mode: 'resize-right',
                  startX: e.clientX,
                  startY: e.clientY,
                  initialWidth: rulerState.width || 420,
                  initialX: rulerState.x,
                  initialY: rulerState.y,
                  angle: rulerState.angle
                };
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                const t = e.touches[0];
                rulerDragRef.current = {
                  mode: 'resize-right',
                  startX: t.clientX,
                  startY: t.clientY,
                  initialWidth: rulerState.width || 420,
                  initialX: rulerState.x,
                  initialY: rulerState.y,
                  angle: rulerState.angle
                };
              }}
              title="Cetveli sağ kenardan uzat veya kısalt"
              className="absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-8 rounded-full bg-amber-600 hover:bg-amber-700 border-2 border-white shadow cursor-ew-resize flex items-center justify-center z-20"
            >
              <span className="w-[1.5px] h-3.5 bg-white/90 rounded-full" />
            </div>

            {/* Üst Santimetre & Milimetre Çizgileri */}
            <div className="relative w-full h-5 flex items-start px-3 overflow-hidden">
              {(() => {
                const cmCount = Math.max(8, Math.round((rulerState.width || 420) / 28));
                const totalTicks = cmCount * 10 + 1;
                return Array.from({ length: totalTicks }, (_, mm) => {
                  const isCm = mm % 10 === 0;
                  const isHalfCm = mm % 5 === 0 && !isCm;
                  return (
                    <div
                      key={mm}
                      className="relative flex-1 flex flex-col items-center"
                    >
                      <div
                        className={`w-[1px] bg-slate-800/80 ${
                          isCm ? 'h-3.5' : isHalfCm ? 'h-2.5' : 'h-1.5 opacity-60'
                        }`}
                      />
                      {isCm && (
                        <span className="text-[8px] font-bold text-slate-800 leading-none mt-0.5">
                          {mm / 10}
                        </span>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Orta Kontrol Şeridi (Derece Göstergesi, 0-90-180-270 Hızlı Açılar, Çizgi Çek, Döndür, Kapat) */}
            <div className="px-3 pb-1.5 flex items-center justify-between gap-1 text-[10px] text-amber-950/80">
              <div className="flex items-center gap-1 shrink-0">
                <Ruler className="w-3.5 h-3.5 text-amber-800" />
                <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-50 font-mono font-bold text-[10px] shadow-2xs">
                  {rulerState.angle}°
                </span>
              </div>

              {/* 0° - 90° - 180° - 270° Tek Tıkla Hızlı Açı Düğmeleri */}
              <div className="flex items-center gap-0.5 bg-amber-200/70 p-0.5 rounded border border-amber-800/15">
                {[0, 90, 180, 270].map((presetDeg) => (
                  <button
                    key={presetDeg}
                    type="button"
                    onClick={() => setRulerState((prev) => ({ ...prev, angle: presetDeg }))}
                    className={`px-1 py-0.2 rounded font-mono font-bold text-[9.5px] transition ${
                      rulerState.angle === presetDeg
                        ? 'bg-amber-800 text-white shadow-2xs'
                        : 'text-amber-950 hover:bg-white/80'
                    }`}
                    title={`Cetveli ${presetDeg}° açısına getir`}
                  >
                    {presetDeg}°
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => drawLineAlongRuler()}
                  className="px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs transition flex items-center gap-1"
                  title="Cetvelin üst kenarı boyunca anında düz çizgi çek"
                >
                  <span>Çizgi Çek</span>
                </button>

                <div
                  data-ruler-rotate="true"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rulerEl = document.getElementById('agenda-ruler');
                    if (!rulerEl) return;
                    const rect = rulerEl.getBoundingClientRect();
                    rulerDragRef.current = {
                      mode: 'rotate',
                      centerX: rect.left + rect.width / 2,
                      centerY: rect.top + rect.height / 2
                    };
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    const rulerEl = document.getElementById('agenda-ruler');
                    if (!rulerEl) return;
                    const rect = rulerEl.getBoundingClientRect();
                    rulerDragRef.current = {
                      mode: 'rotate',
                      centerX: rect.left + rect.width / 2,
                      centerY: rect.top + rect.height / 2
                    };
                  }}
                  title="Cetveli 360° Döndürmek İçin Sürükleyin (0°, 90°, 180°, 270° açılara otomatik kilitlenir)"
                  className="px-1.5 py-0.5 rounded bg-sky-600 hover:bg-sky-700 text-white font-semibold cursor-ew-resize flex items-center gap-1 shadow-2xs"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Döndür</span>
                </div>

                <button
                  type="button"
                  onClick={() => setRulerVisible(false)}
                  className="w-5 h-5 rounded bg-rose-500 hover:bg-rose-600 text-white font-bold flex items-center justify-center transition"
                  title="Cetveli Kapat"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ALT ARAÇ PANELİ (Yalnızca Simgeler, Tıklamayla Gizlenip Açılır) */}
      <footer
        onClick={(e) => e.stopPropagation()}
        className={`fixed bottom-0 left-0 right-0 z-40 h-14 px-6 bg-white/90 backdrop-blur-md border-t border-slate-200/80 flex items-center justify-center gap-4 transition-all duration-300 ${
          panelsVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={() => insertTextBox('default')}
          className="p-2.5 rounded-xl hover:bg-slate-100 active:scale-95 text-slate-700 transition"
          title="Metin Kutusu Ekle"
        >
          <Type className="w-5 h-5" />
        </button>

        {/* Tablo Ekleme Menüsü */}
        <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              setTableMenuOpen((prev) => !prev);
              setShapeMenuOpen(false);
              setPageBgPaletteOpen(false);
              setGalleryOpen(false);
            }}
            className={`p-2.5 rounded-xl active:scale-95 transition ${
              tableMenuOpen ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-300' : 'hover:bg-slate-100 text-slate-700'
            }`}
            title="Tablo Ekle"
          >
            <Table2 className="w-5 h-5" />
          </button>

          {tableMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-14 left-1/2 -translate-x-1/2 w-64 p-3 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <span className="text-[11px] font-bold text-slate-700">
                  Tablo Ekle ({tableGridHover.rows} × {tableGridHover.cols})
                </span>
                <button
                  type="button"
                  onClick={() => setTableMenuOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>

              {/* İnteraktif Satır × Sütun Izgara Seçici (8x6) */}
              <div className="grid grid-cols-6 gap-1 p-1.5 bg-slate-50 rounded-xl border border-slate-200/80">
                {Array.from({ length: 8 }, (_, r) =>
                  Array.from({ length: 6 }, (__, c) => {
                    const active = r < tableGridHover.rows && c < tableGridHover.cols;
                    return (
                      <button
                        key={`${r}_${c}`}
                        type="button"
                        onMouseEnter={() => setTableGridHover({ rows: r + 1, cols: c + 1 })}
                        onClick={() => {
                          insertTableBox(r + 1, c + 1, '#ffffff');
                          setTableMenuOpen(false);
                        }}
                        className={`h-5 rounded-[4px] border transition ${
                          active
                            ? 'bg-sky-500 border-sky-600 shadow-2xs'
                            : 'bg-white border-slate-300/80 hover:border-sky-400'
                        }`}
                        title={`${r + 1} Satır × ${c + 1} Sütun Tablo Ekle`}
                      />
                    );
                  })
                )}
              </div>

              {/* Hızlı Hazır Ajanda Tablo Şablonları */}
              <div className="flex flex-col gap-1 pt-1 border-t border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400">Hızlı Tablo Şablonları</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: '2×4 Liste', rows: 4, cols: 2, bg: '#ffffff' },
                    { label: '3×5 Planlayıcı', rows: 5, cols: 3, bg: '#fefce8' },
                    { label: '4×4 Çizelge', rows: 4, cols: 4, bg: '#f0f9ff' },
                    { label: '7×2 Haftalık', rows: 7, cols: 2, bg: '#fdf2f8' }
                  ].map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => {
                        insertTableBox(tpl.rows, tpl.cols, tpl.bg);
                        setTableMenuOpen(false);
                      }}
                      className="px-2 py-1.5 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-sky-50/70 text-[11px] font-semibold text-slate-700 transition text-center"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Şekil Ekleme Menüsü */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShapeMenuOpen((prev) => !prev);
              setTableMenuOpen(false);
              setPageBgPaletteOpen(false);
            }}
            className="p-2.5 rounded-xl hover:bg-slate-100 active:scale-95 text-slate-700 transition"
            title="Şekil Ekle"
          >
            <Shapes className="w-5 h-5" />
          </button>

          {shapeMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-14 left-1/2 -translate-x-1/2 w-64 p-3 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <span className="text-[11px] font-bold text-slate-700">Sayfaya Şekil Ekle</span>
                <button
                  type="button"
                  onClick={() => setShapeMenuOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'rect', label: 'Dikdörtgen', icon: '▭', color: '#bae6fd' },
                  { id: 'circle', label: 'Daire', icon: '●', color: '#fbcfe8' },
                  { id: 'triangle', label: 'Üçgen', icon: '▲', color: '#fde047' },
                  { id: 'star', label: 'Yıldız', icon: '★', color: '#fef3c7' },
                  { id: 'heart', label: 'Kalp', icon: '♥', color: '#ffe4e6' },
                  { id: 'diamond', label: 'Elmas', icon: '◆', color: '#ddd6fe' },
                  { id: 'hexagon', label: 'Altıgen', icon: '⬡', color: '#f3e8ff' },
                  { id: 'arrow', label: 'Ok', icon: '➔', color: '#bbf7d0' },
                  { id: 'bubble', label: 'Balon', icon: '💬', color: '#e0f2fe' },
                  { id: 'sticky', label: 'Not Kağıdı', icon: '📝', color: '#fef08a' },
                  { id: 'ribbon', label: 'Etiket', icon: '🏷️', color: '#fed7aa' },
                  { id: 'oval', label: 'Rozet', icon: '⬭', color: '#dcfce7' }
                ].map((sh) => (
                  <button
                    key={sh.id}
                    type="button"
                    onClick={() => {
                      insertTextBox(sh.id, sh.color);
                      setShapeMenuOpen(false);
                    }}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl border border-slate-200/80 hover:border-sky-400 hover:bg-sky-50/60 transition"
                  >
                    <span
                      style={{ backgroundColor: sh.color }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-sm text-slate-800 shadow-2xs"
                    >
                      {sh.icon}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-700">{sh.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 rounded-xl hover:bg-slate-100 active:scale-95 text-slate-700 transition"
          title="Bilgisayardan Resim Yükle"
        >
          <ImageIcon className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => setRulerVisible((prev) => !prev)}
          className={`p-2.5 rounded-xl active:scale-95 transition ${
            rulerVisible
              ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
          title="Cetveli Göster / Gizle"
        >
          <Ruler className="w-5 h-5" />
        </button>

        {/* Seçili Sayfa Arkaplan Rengi Seçici */}
        <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPageBgPaletteOpen((prev) => !prev);
              setShapeMenuOpen(false);
              setGalleryOpen(false);
              setTableMenuOpen(false);
            }}
            className={`px-2.5 py-2 rounded-xl active:scale-95 transition flex items-center gap-1.5 border ${
              pageBgPaletteOpen
                ? 'bg-sky-50 text-sky-700 border-sky-300 shadow-2xs'
                : 'hover:bg-slate-100 text-slate-700 border-transparent'
            }`}
            title={`Seçili Sayfanın (${isCoverView ? 'Kapak Sayfası (0)' : `Sayfa ${activeEditorTarget === 'left' ? currentLeftPage : currentRightPage}`}) Arkaplan Rengini Değiştir`}
          >
            <Palette className="w-5 h-5" />
            <span
              className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-2xs"
              style={{
                backgroundColor:
                  pageBgColors[isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage)] || (isCoverView ? '#f5efe6' : '#fdfbf7')
              }}
            />
          </button>

          {pageBgPaletteOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute bottom-14 left-1/2 -translate-x-1/2 w-72 sm:w-80 p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[60] flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-700">
                    {isCoverView
                      ? 'Kapak (0) Arkaplanı'
                      : `Sayfa ${activeEditorTarget === 'left' ? currentLeftPage : currentRightPage} Arkaplanı`}
                  </span>
                  {!isCoverView && (
                    <div className="flex items-center bg-slate-100 rounded-md p-0.5 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveEditorTarget('left'); }}
                        className={`px-1.5 py-0.5 rounded transition ${
                          activeEditorTarget === 'left' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
                        }`}
                      >
                        Sol ({currentLeftPage})
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveEditorTarget('right'); }}
                        className={`px-1.5 py-0.5 rounded transition ${
                          activeEditorTarget === 'right' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
                        }`}
                      >
                        Sağ ({currentRightPage})
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPageBgPaletteOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>

              {/* Hızlı Ajanda Kağıdı Tonları */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-slate-400">Doğal Defter Kağıdı Tonları</span>
                <div className="flex items-center justify-between gap-1">
                  {[
                    { color: '#fdfbf7', label: 'Fildişi Ajanda (Varsayılan)' },
                    { color: '#ffffff', label: 'Saf Beyaz Kağıt' },
                    { color: '#f6efe2', label: 'Antik Parşömen' },
                    { color: '#efe3cf', label: 'Sıcak Kraft Kağıt' },
                    { color: '#fef9d7', label: 'Krem Sarı Not' },
                    { color: '#edf4ed', label: 'Adaçayı Kağıdı' },
                    { color: '#ebf2f7', label: 'Buz Mavisi Kağıt' },
                    { color: '#f7edf2', label: 'Pudra Gül Kağıdı' }
                  ].map((preset) => {
                    const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                    const currentBg = pageBgColors[activePage] || (isCoverView ? '#f5efe6' : '#fdfbf7');
                    return (
                      <button
                        key={preset.color}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); savePageBgColor(activePage, preset.color); }}
                        style={{ backgroundColor: preset.color }}
                        className={`w-6 h-6 rounded-full border transition-transform hover:scale-110 ${
                          currentBg.toLowerCase() === preset.color ? 'ring-2 ring-sky-500 border-white scale-110' : 'border-slate-300'
                        }`}
                        title={preset.label}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Defter Uyumlu Yumuşak Pastel Renk Matrisi (60 Ton) */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-slate-400">Defter Uyumlu Pastel & Kağıt Tonları</span>
                <div className="grid grid-cols-10 gap-1">
                  {[
                    '#fdfbf7', '#faf6ee', '#f6efe2', '#efe3cf', '#e6d5b8', '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1',
                    '#fff8f6', '#ffefeb', '#ffe4de', '#ffd5cc', '#ffc4b8', '#fff5f7', '#ffe8ee', '#ffd9e3', '#ffc7d6', '#f8b4c6',
                    '#fffaf0', '#fff2db', '#ffe8c2', '#ffdda6', '#ffd08a', '#fefce8', '#fef9d7', '#fef4be', '#fdefa1', '#fce883',
                    '#f4faf4', '#e6f4e7', '#d5ecd7', '#c2e3c5', '#aed9b2', '#f0f9f8', '#def2f0', '#c9e8e5', '#b2ddd9', '#9ad1cc',
                    '#f2f7fc', '#e2eef9', '#cfe3f5', '#bad6f0', '#a3c8ea', '#f5f3ff', '#ebe6fe', '#dfd7fd', '#d2c6fc', '#c3b3fa',
                    '#faf5f9', '#f3e8f1', '#ead8e7', '#dfc6db', '#d3b2ce', '#f7f4f1', '#ede7e1', '#e2d9d0', '#d5c9be', '#c7b8ab'
                  ].map((hex) => {
                    const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                    const currentBg = pageBgColors[activePage] || (isCoverView ? '#f5efe6' : '#fdfbf7');
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); savePageBgColor(activePage, hex); }}
                        style={{ backgroundColor: hex }}
                        className={`w-4 h-4 rounded-xs border transition-transform hover:scale-125 ${
                          currentBg.toLowerCase() === hex ? 'ring-2 ring-sky-500 border-white' : 'border-slate-300/70'
                        }`}
                        title={hex.toUpperCase()}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Özel Renk Çarkı ve Sıfırla Seçeneği */}
              <div className="pt-1.5 border-t border-slate-100 flex flex-col gap-1.5">
                {/* Seçili Sayfaya Arkaplan Resmi Ekle / Kaldır / Ayarla */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (bgImageInputRef.current) {
                          bgImageInputRef.current.value = '';
                          bgImageInputRef.current.click();
                        }
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[10px] font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Arkaplan Resmi Seç</span>
                    </button>

                    {pageBgImages[isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage)] && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                          setBgImageModalPage(activePage);
                          const cfg = pageBgImageConfigs[activePage] || { scale: 100, posX: 50, posY: 50, repeat: 'no-repeat' };
                          setBgConfigScale(cfg.scale);
                          setBgConfigPosX(cfg.posX);
                          setBgConfigPosY(cfg.posY);
                          setBgConfigRepeat(cfg.repeat);
                          setPageBgPaletteOpen(false);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-semibold transition"
                        title="Arkaplan Resmini Konumlandır ve Ayarla"
                      >
                        Ayarlar
                      </button>
                    )}
                  </div>

                  {pageBgImages[isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage)] && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                        savePageBgImage(activePage, null);
                        showGalleryToast('Arkaplan resmi kaldırıldı');
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[10px] font-semibold transition text-center"
                      title="Sayfa Arkaplan Resmini Kaldır"
                    >
                      Resmi Kaldır
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                      savePageBgColor(activePage, isCoverView ? '#f5efe6' : '#fdfbf7');
                      savePageBgImage(activePage, null);
                      showGalleryToast('Varsayılan kağıt görünümüne sıfırlandı');
                    }}
                    className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600 transition"
                  >
                    Ajanda Kağıdına Sıfırla
                  </button>
                  <label 
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer transition"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-slate-300"
                      style={{
                        backgroundColor:
                          pageBgColors[isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage)] || (isCoverView ? '#f5efe6' : '#fdfbf7')
                      }}
                    />
                    <span>Renk Çarkı</span>
                    <input
                      type="color"
                      value={pageBgColors[isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage)] || (isCoverView ? '#f5efe6' : '#fdfbf7')}
                      onChange={(e) => {
                        const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                        savePageBgColor(activePage, e.target.value);
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Doğrudan Seçili Sayfaya Arkaplan Resmi Ekleme ve Kaldırma Hızlı Düğmeleri */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (bgImageInputRef.current) {
                bgImageInputRef.current.value = '';
                bgImageInputRef.current.click();
              }
            }}
            className="px-2.5 py-2 rounded-xl hover:bg-slate-100 active:scale-95 text-slate-700 transition flex items-center gap-1.5 border border-slate-200/80 bg-slate-50/70"
            title={`${isCoverView ? 'Kapak Sayfası (0)' : `Sayfa ${activeEditorTarget === 'left' ? currentLeftPage : currentRightPage}`} Arkaplanına Resim Ekle`}
          >
            <ImageIcon className="w-4 h-4 text-sky-600" />
            <span className="text-[11px] font-semibold hidden sm:inline">Arkaplan Resmi</span>
          </button>

          {pageBgImages[isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage)] && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                  setBgImageModalPage(activePage);
                  const cfg = pageBgImageConfigs[activePage] || { scale: 100, posX: 50, posY: 50, repeat: 'no-repeat' };
                  setBgConfigScale(cfg.scale);
                  setBgConfigPosX(cfg.posX);
                  setBgConfigPosY(cfg.posY);
                  setBgConfigRepeat(cfg.repeat);
                }}
                className="px-2.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white transition flex items-center gap-1 shadow-2xs"
                title="Arkaplan Resmini Konumlandır ve Ayarla"
              >
                <Sliders className="w-4 h-4" />
                <span className="text-[11px] font-semibold hidden sm:inline">Arkaplan Ayarı</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const activePage = isCoverView ? 0 : (activeEditorTarget === 'left' ? currentLeftPage : currentRightPage);
                  savePageBgImage(activePage, null);
                  showGalleryToast('Arkaplan resmi kaldırıldı');
                }}
                className="px-2.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 transition flex items-center gap-1 border border-rose-200"
                title="Arkaplan Resmini Kaldır"
              >
                <Trash2 className="w-4 h-4 text-rose-600" />
              </button>
            </>
          )}
        </div>

        {/* Kayıtlı Görseller Galerisi Aç/Kapat Düğmesi (Arkaplan Resmi Seçeneğinin Sağında) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setGalleryOpen((prev) => !prev);
              setShapeMenuOpen(false);
              setPageBgPaletteOpen(false);
            }}
            className={`px-2.5 py-2 rounded-xl active:scale-95 transition flex items-center gap-1.5 border ${
              galleryOpen
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'hover:bg-slate-100 text-slate-700 border-slate-200/80 bg-slate-50/70'
            }`}
            title="Kayıtlı Görseller Galerisi (Düzenlenen ve kaydedilen görselleri başka sayfalarda kullan)"
          >
            <FolderHeart className={`w-4 h-4 ${galleryOpen ? 'text-white' : 'text-emerald-600'}`} />
            <span className="text-[11px] font-semibold hidden sm:inline">Kayıtlı Görseller</span>
            {savedImages.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  galleryOpen ? 'bg-white text-emerald-700' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {savedImages.length}
              </span>
            )}
          </button>

          {/* Kayıtlı Görseller Açılır Galeri Paneli */}
          {galleryOpen && (
            <div
              id="saved-images-gallery"
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-14 left-1/2 -translate-x-1/2 w-80 sm:w-96 p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <FolderHeart className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Kayıtlı Görseller ({savedImages.length})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center gap-1 transition"
                    title="Yeni Görsel Yükle ve Kaydet"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Yeni Yükle</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryOpen(false)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {savedImages.length === 0 ? (
                <div className="py-8 px-4 text-center flex flex-col items-center gap-2 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
                  <ImageIcon className="w-7 h-7 text-slate-300" />
                  <p className="text-xs font-semibold text-slate-600">Henüz kayıtlı görsel bulunmuyor</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Ajandaya yüklediğiniz veya kırpıp arkaplanını sildiğiniz görseller buraya kaydedilir; istediğiniz sayfaya tek tıkla ekleyebilirsiniz.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-0.5">
                  {savedImages.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedTapeImage(item);
                        setPenMode(false);
                        setActiveTextBoxId(null);
                        setGalleryOpen(false);
                        showGalleryToast('Bant modu aktif: Sayfada sol tıka basılı tutup sürükleyin');
                      }}
                      style={{
                        backgroundImage:
                          'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
                        backgroundSize: '12px 12px',
                        backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px'
                      }}
                      className={`group relative aspect-square rounded-xl border overflow-hidden cursor-pointer bg-white shadow-2xs transition flex items-center justify-center p-1.5 ${
                        selectedTapeImage?.id === item.id
                          ? 'border-emerald-500 ring-2 ring-emerald-400'
                          : 'border-slate-200 hover:border-emerald-500'
                      }`}
                      title="Bant Olarak Çekmek İçin Seç (veya + ile Tek Resim Ekle)"
                    >
                      <img
                        src={item.src}
                        alt={item.label}
                        style={
                          item.width
                            ? {
                                width: `${Math.min(72, Math.max(22, Math.round(item.width * 0.42)))}px`,
                                height: item.height
                                  ? `${Math.min(72, Math.max(22, Math.round(item.height * 0.42)))}px`
                                  : 'auto'
                              }
                            : undefined
                        }
                        className="max-w-full max-h-full object-contain pointer-events-none transition-transform"
                      />
                      {item.width && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-slate-900/75 text-white text-[9px] font-mono font-semibold pointer-events-none group-hover:opacity-0 transition">
                          {item.width}px
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          placeImageOnActivePage(item.src, {
                            width: item.width,
                            height: item.height
                          });
                          showGalleryToast('Görsel kayıtlı boyutunda sayfaya eklendi');
                        }}
                        className="absolute top-1 left-1 px-1.5 h-5 rounded-md bg-sky-600/90 hover:bg-sky-700 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition flex items-center justify-center shadow"
                        title="Kayıtlı Boyutunda Tekil Resim Olarak Ekle"
                      >
                        + Tek
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          placeImageOnDesk(item.src, {
                            width: item.width,
                            height: item.height
                          });
                          setGalleryOpen(false);
                        }}
                        className="absolute top-7 left-1 px-1.5 h-5 rounded-md bg-amber-600/90 hover:bg-amber-700 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition flex items-center justify-center shadow"
                        title="Bu görseli masanın üzerine koy"
                      >
                        Masa
                      </button>
                      <div className="absolute inset-x-0 bottom-0 bg-emerald-700/85 text-white text-[9px] font-semibold px-1.5 py-1 opacity-0 group-hover:opacity-100 transition truncate text-center">
                        Bant Çek
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImageFromGallery(item.id);
                          if (selectedTapeImage?.id === item.id) {
                            setSelectedTapeImage(null);
                          }
                        }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-md bg-rose-500/90 hover:bg-rose-600 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition flex items-center justify-center shadow"
                        title="Galeriden Sil"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Seçili Sayfa Defter Düzeni (Düz / Çizgili / Kareli / Noktalı - Araç Çubuğunda Orta-Sağ Konum) */}
        {(() => {
          const activeTargetPage = isCoverView
            ? 0
            : activeEditorTarget === 'left'
            ? currentLeftPage
            : currentRightPage;
          const activeRuling = pageRulings[activeTargetPage] || 'plain';
          const pageLabel = isCoverView ? 'Kapak (0)' : `Sayfa ${activeTargetPage}`;

          return (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 gap-0.5 overflow-x-auto"
              title={`${pageLabel} için defter kağıdı düzeni`}
            >
              {[
                {
                  id: 'plain',
                  label: 'Düz',
                  icon: (
                    <span className="w-3.5 h-3.5 rounded-[3px] border border-current inline-block bg-white/60 shrink-0" />
                  )
                },
                {
                  id: 'lined',
                  label: 'Çizgili',
                  icon: (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <line x1="2" y1="4" x2="14" y2="4" />
                      <line x1="2" y1="8" x2="14" y2="8" />
                      <line x1="2" y1="12" x2="14" y2="12" />
                    </svg>
                  )
                },
                {
                  id: 'grid',
                  label: 'Kareli',
                  icon: (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <rect x="2" y="2" width="12" height="12" rx="1.5" />
                      <line x1="6" y1="2" x2="6" y2="14" />
                      <line x1="10" y1="2" x2="10" y2="14" />
                      <line x1="2" y1="6" x2="14" y2="6" />
                      <line x1="2" y1="10" x2="14" y2="10" />
                    </svg>
                  )
                },
                {
                  id: 'dotted',
                  label: 'Noktalı',
                  icon: (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="4" cy="4" r="1.5" />
                      <circle cx="12" cy="4" r="1.5" />
                      <circle cx="4" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                    </svg>
                  )
                }
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => savePageRuling(activeTargetPage, opt.id)}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0 transition ${
                    activeRuling === opt.id
                      ? 'bg-white text-sky-700 shadow-xs ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                  title={`${pageLabel}: ${opt.label} Defter`}
                >
                  {opt.icon}
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              ))}
            </div>
          );
        })()}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />

        <input
          ref={bgImageInputRef}
          type="file"
          accept="image/*"
          onChange={handlePageBgImageUpload}
          className="hidden"
        />
      </footer>

      {/* ARAÇLAR GİZLİYKEN EKRANDA BOŞ YERE TIKLANDIĞINI HATIRLATAN / HIZLI AÇMA DÜĞMESİ */}
      {!panelsVisible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPanelsVisible(true);
          }}
          className="fixed bottom-4 right-4 z-40 px-3 py-1.5 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white text-[11px] font-semibold backdrop-blur-md shadow-lg transition flex items-center gap-1.5"
          title="Üst ve Alt Araç Çubuklarını Göster"
        >
          <span>Araçları Göster</span>
        </button>
      )}

      {/* RESİM DÜZENLEME PENCERESİ (KIRPMA & ARKAPLAN KALDIRMA) */}
      {editingImageModal && (
        <div
          id="image-editor-modal"
          onClick={() => {
            setEditingImageModal(null);
            setBgRemovedPreviewSrc(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
          >
            {/* Üst Başlık */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <Crop className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-800">Resmi Düzenle (Kırp & Arkaplan Kaldır)</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingImageModal(null);
                  setBgRemovedPreviewSrc(null);
                }}
                className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-500 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Kırpma ve Arkaplan Önizleme Alanı (Şeffaflık Izgaralı) */}
            <div
              className="relative flex-1 min-h-[280px] sm:min-h-[360px] flex items-center justify-center p-6 overflow-hidden select-none"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                backgroundColor: '#f8fafc'
              }}
            >
              <div ref={cropContainerRef} className="relative inline-block max-w-full max-h-[52vh]">
                {manualBrushMode ? (
                  <div
                    className="relative inline-block touch-none"
                    onMouseMove={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setBrushCursorPos({ x: e.clientX - r.left, y: e.clientY - r.top });
                      if (isBrushingRef.current) {
                        applyManualBrushStroke(e.clientX, e.clientY, false);
                      }
                    }}
                    onMouseLeave={() => {
                      setBrushCursorPos(null);
                      finishManualBrushStroke();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      isBrushingRef.current = true;
                      applyManualBrushStroke(e.clientX, e.clientY, true);
                    }}
                    onMouseUp={finishManualBrushStroke}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      const t = e.touches[0];
                      isBrushingRef.current = true;
                      applyManualBrushStroke(t.clientX, t.clientY, true);
                    }}
                    onTouchMove={(e) => {
                      e.preventDefault();
                      const t = e.touches[0];
                      if (isBrushingRef.current) {
                        applyManualBrushStroke(t.clientX, t.clientY, false);
                      }
                    }}
                    onTouchEnd={finishManualBrushStroke}
                  >
                    <canvas
                      ref={brushCanvasRef}
                      className="max-w-full max-h-[52vh] w-auto h-auto block rounded-md shadow-md cursor-none"
                    />
                    {brushCursorPos && (
                      <div
                        style={{
                          left: `${brushCursorPos.x}px`,
                          top: `${brushCursorPos.y}px`,
                          width: `${brushSize}px`,
                          height: `${brushSize}px`
                        }}
                        className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                          manualBrushMode === 'erase'
                            ? 'border-rose-500 bg-rose-500/20'
                            : 'border-emerald-500 bg-emerald-500/20'
                        }`}
                      />
                    )}
                  </div>
                ) : (
                  <>
                    <img
                      src={bgRemovedPreviewSrc || editingImageModal.currentSrc}
                      alt="Düzenlenen Görsel"
                      draggable="false"
                      className="max-w-full max-h-[52vh] w-auto h-auto block rounded-md shadow-md pointer-events-none"
                    />

                    {/* Kırpma Dışı Karartma Maskesi */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundColor: 'rgba(15, 23, 42, 0.48)',
                        clipPath: `polygon(0% 0%, 0% 100%, ${cropRect.x}% 100%, ${cropRect.x}% ${cropRect.y}%, ${cropRect.x + cropRect.width}% ${cropRect.y}%, ${cropRect.x + cropRect.width}% ${cropRect.y + cropRect.height}%, ${cropRect.x}% ${cropRect.y + cropRect.height}%, ${cropRect.x}% 100%, 100% 100%, 100% 0%)`
                      }}
                    />

                    {/* Etkileşimli Kırpma Çerçevesi */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                        cropDragRef.current = { mode: 'move', startX: clientX, startY: clientY, startRect: { ...cropRect } };
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        const clientX = e.touches[0].clientX;
                        const clientY = e.touches[0].clientY;
                        cropDragRef.current = { mode: 'move', startX: clientX, startY: clientY, startRect: { ...cropRect } };
                      }}
                      style={{
                        left: `${cropRect.x}%`,
                        top: `${cropRect.y}%`,
                        width: `${cropRect.width}%`,
                        height: `${cropRect.height}%`
                      }}
                      className="absolute border-2 border-sky-400 shadow-[0_0_0_1px_rgba(255,255,255,0.85)] cursor-move"
                    >
                      {/* Üçte Bir Kuralı Izgara Çizgileri */}
                      <div className="absolute inset-x-0 top-1/3 border-t border-white/50 pointer-events-none" />
                      <div className="absolute inset-x-0 top-2/3 border-t border-white/50 pointer-events-none" />
                      <div className="absolute inset-y-0 left-1/3 border-l border-white/50 pointer-events-none" />
                      <div className="absolute inset-y-0 left-2/3 border-l border-white/50 pointer-events-none" />

                      {/* Sol Üst Kırpma Tutamacı */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          cropDragRef.current = { mode: 'nw', startX: e.clientX, startY: e.clientY, startRect: { ...cropRect } };
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          cropDragRef.current = { mode: 'nw', startX: e.touches[0].clientX, startY: e.touches[0].clientY, startRect: { ...cropRect } };
                        }}
                        className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-sky-600 rounded-full cursor-nw-resize shadow"
                      />

                      {/* Sağ Alt Kırpma Tutamacı */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          cropDragRef.current = { mode: 'se', startX: e.clientX, startY: e.clientY, startRect: { ...cropRect } };
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          cropDragRef.current = { mode: 'se', startX: e.touches[0].clientX, startY: e.touches[0].clientY, startRect: { ...cropRect } };
                        }}
                        className="absolute -right-2 -bottom-2 w-4 h-4 bg-sky-600 border-2 border-white rounded-full cursor-se-resize shadow"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Kontrol Araçları: Kırpma Oranları + Arkaplan Kaldırma */}
            <div className="p-4 bg-white border-t border-slate-100 flex flex-col gap-3">
              {/* Kırpma En-Boy Oranı Seçenekleri */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
                    <Crop className="w-3.5 h-3.5 text-sky-600" />
                    Kırpma Oranı:
                  </span>
                  {[
                    { id: 'free', label: 'Serbest' },
                    { id: '1:1', label: '1:1 Kare' },
                    { id: '4:3', label: '4:3' },
                    { id: '16:9', label: '16:9' }
                  ].map((ratio) => (
                    <button
                      key={ratio.id}
                      type="button"
                      onClick={() => {
                        setManualBrushMode(null);
                        setCropAspect(ratio.id);
                        if (ratio.id === '1:1') {
                          setCropRect({ x: 15, y: 15, width: 70, height: 70 });
                        } else if (ratio.id === '4:3') {
                          setCropRect({ x: 10, y: 15, width: 80, height: 60 });
                        } else if (ratio.id === '16:9') {
                          setCropRect({ x: 5, y: 22, width: 90, height: 50 });
                        } else {
                          setCropRect({ x: 0, y: 0, width: 100, height: 100 });
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                        !manualBrushMode && cropAspect === ratio.id
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>

                {/* Orijinale Sıfırla */}
                <button
                  type="button"
                  onClick={() => {
                    setBgRemovedPreviewSrc(null);
                    setManualBrushMode(null);
                    setCropAspect('free');
                    setCropRect({ x: 0, y: 0, width: 100, height: 100 });
                    setEditingImageModal((prev) =>
                      prev ? { ...prev, currentSrc: prev.originalSrc } : null
                    );
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Orijinale Dön</span>
                </button>
              </div>

              {/* Arkaplan Kaldırma (Otomatik + Elle Fırça) Kontrol Satırı */}
              <div className="flex flex-col gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">Arkaplan Kaldırma:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">Hassasiyet:</span>
                      <input
                        type="range"
                        min="10"
                        max="80"
                        value={bgRemoveTolerance}
                        onChange={(e) => setBgRemoveTolerance(Number(e.target.value))}
                        className="w-24 accent-sky-600 cursor-pointer"
                      />
                      <span className="text-[11px] font-mono font-bold text-slate-700 w-6">{bgRemoveTolerance}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isProcessingBg}
                    onClick={() => processRemoveBackground(editingImageModal.currentSrc, bgRemoveTolerance)}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5"
                  >
                    {isProcessingBg ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Kaldırılıyor...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Arka Planı Kaldır</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Elle Rötuş Fırçaları */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-600">Elle Rötuş:</span>
                    <button
                      type="button"
                      onClick={() => setManualBrushMode(manualBrushMode === 'erase' ? null : 'erase')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${
                        manualBrushMode === 'erase' ? 'bg-rose-600 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      }`}
                    >
                      {manualBrushMode === 'erase' ? 'Silme Modu Aktif' : 'Elle Sil'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualBrushMode(manualBrushMode === 'restore' ? null : 'restore')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${
                        manualBrushMode === 'restore' ? 'bg-emerald-600 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      }`}
                    >
                      {manualBrushMode === 'restore' ? 'Geri Getir Aktif' : 'Geri Getir'}
                    </button>
                    {manualBrushMode && (
                      <div className="flex items-center gap-1 ml-2">
                        <span className="text-[10px] text-slate-500">Boyut:</span>
                        <input
                          type="range"
                          min="8"
                          max="64"
                          value={brushSize}
                          onChange={(e) => setBrushSize(Number(e.target.value))}
                          className="w-16 accent-sky-600 cursor-pointer"
                        />
                      </div>
                    )}
                  </div>

                  {manualBrushMode && (
                    <button
                      type="button"
                      onClick={() => setManualBrushMode(null)}
                      className="text-[11px] font-semibold text-sky-600 hover:underline"
                    >
                      Rötuşu Bitir
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Alt Onay ve Kaydetme Butonları */}
            <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setEditingImageModal(null);
                  setBgRemovedPreviewSrc(null);
                  setManualBrushMode(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => applyImageEdits(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5"
              >
                <FolderHeart className="w-4 h-4" />
                <span>Galeriye Kaydet & Uygula</span>
              </button>
              <button
                type="button"
                onClick={() => applyImageEdits(false)}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Sayfaya Uygula</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GÜVENLİ ARKAPLAN RESMİ KONUMLANDIRMA VE AYAR PENCERESİ */}
      {bgImageModalPage !== null && pageBgImages[bgImageModalPage] && (
        <div
          onClick={() => setBgImageModalPage(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col p-5 gap-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  {bgImageModalPage === 0 ? 'Kapak Arkaplan Resmi Ayarı' : `Sayfa ${bgImageModalPage} Arkaplan Resmi Ayarı`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBgImageModalPage(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Gerçek Sayfa Oranına Sahip Canlı Defter Sayfası Önizlemesi */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">Defter Sayfasında Durum Önizlemesi:</span>
              <div 
                className="relative w-48 h-64 rounded-xl border-2 border-amber-900/20 bg-white overflow-hidden shadow-md flex flex-col p-3"
                style={{
                  backgroundColor: pageBgColors[bgImageModalPage] || '#fdfbf7'
                }}
              >
                <div
                  style={{
                    backgroundImage: `url(${pageBgImages[bgImageModalPage]})`,
                    backgroundSize: bgConfigRepeat === 'no-repeat' ? (bgConfigScale === 100 ? 'cover' : `${bgConfigScale}%`) : `${bgConfigScale}%`,
                    backgroundPosition: `${bgConfigPosX}% ${bgConfigPosY}%`,
                    backgroundRepeat: bgConfigRepeat
                  }}
                  className="absolute inset-0 transition-all duration-75"
                />
                {/* Sayfa üstü temsili içerik çizgileri */}
                <div className="relative z-10 space-y-2 opacity-50 pointer-events-none mt-2">
                  <div className="w-3/4 h-2 rounded bg-slate-800/25" />
                  <div className="w-full h-1.5 rounded bg-slate-800/15" />
                  <div className="w-5/6 h-1.5 rounded bg-slate-800/15" />
                </div>
                <div className="absolute bottom-2 right-3 z-10 text-[9px] font-mono font-bold text-slate-600/70">
                  {bgImageModalPage === 0 ? 'Kapak' : bgImageModalPage}
                </div>
              </div>
            </div>

            {/* Hassas Ayar Kontrolleri */}
            <div className="flex flex-col gap-3 text-xs">
              {/* Hızlı Hazır Konumlar */}
              <div className="flex flex-col gap-1">
                <span className="font-bold text-slate-700">Hızlı Hizalama:</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: 'Sol Üst', x: 0, y: 0 },
                    { label: 'Orta', x: 50, y: 50 },
                    { label: 'Sağ Alt', x: 100, y: 100 }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setBgConfigPosX(preset.x);
                        setBgConfigPosY(preset.y);
                      }}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-semibold text-slate-700">
                  <span>Ölçek / Boyut:</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBgConfigScale(100)}
                      className="text-[10px] text-sky-600 hover:underline font-mono"
                    >
                      (Normal %100)
                    </button>
                    <span className="font-mono font-bold text-sky-600">%{bgConfigScale}</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="20"
                  max="400"
                  value={bgConfigScale}
                  onChange={(e) => setBgConfigScale(Number(e.target.value))}
                  className="accent-sky-600 cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-semibold text-slate-700">
                  <span>Yatay Konum (Sol ⇄ Sağ):</span>
                  <span className="font-mono font-bold text-sky-600">%{bgConfigPosX}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={bgConfigPosX}
                  onChange={(e) => setBgConfigPosX(Number(e.target.value))}
                  className="accent-sky-600 cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-semibold text-slate-700">
                  <span>Dikey Konum (Yukarı ⇄ Aşağı):</span>
                  <span className="font-mono font-bold text-sky-600">%{bgConfigPosY}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={bgConfigPosY}
                  onChange={(e) => setBgConfigPosY(Number(e.target.value))}
                  className="accent-sky-600 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="font-semibold text-slate-700">Görsel Yerleşimi / Tekrarı:</span>
                <select
                  value={bgConfigRepeat}
                  onChange={(e) => setBgConfigRepeat(e.target.value)}
                  className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium outline-none cursor-pointer"
                >
                  <option value="no-repeat">Tek (Sayfayı Tam Kapla)</option>
                  <option value="repeat">Döşe (Tüm Sayfaya Tekrarla)</option>
                  <option value="repeat-x">Yatay Döşe</option>
                  <option value="repeat-y">Dikey Döşe</option>
                </select>
              </div>
            </div>

            {/* Onay Butonları */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBgImageModalPage(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  const cfg = { scale: bgConfigScale, posX: bgConfigPosX, posY: bgConfigPosY, repeat: bgConfigRepeat };
                  savePageBgImage(bgImageModalPage, pageBgImages[bgImageModalPage], cfg);
                  setBgImageModalPage(null);
                  showGalleryToast('Arkaplan ayarları kaydedildi');
                }}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-sm transition flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Ayarları Uygula</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GALERİ BİLDİRİM TOAST MESAJI */}
      {galleryToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 animate-fade-in">
          <Check className="w-3.5 h-3.5" />
          <span>{galleryToast}</span>
        </div>
      )}

      {/* BULUT SENKRONİZASYONU VE CİHAZ EŞLEŞTİRME PENCERESİ */}
      {syncModalOpen && (
        <div
          id="cloud-sync-modal"
          onClick={() => setSyncModalOpen(false)}
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
          >
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-800">Bulut Senkronizasyonu</h3>
              </div>
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-500 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4 text-xs text-slate-700">
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 flex items-start gap-2.5">
                <Cloud className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <p className="font-bold text-emerald-900">
                    {syncStatus === 'synced'
                      ? 'Ajandanız bulut hesabınızla otomatik eşitleniyor.'
                      : 'Değişiklikleriniz bulut yedeklemesine hazır.'}
                  </p>
                  <p className="text-emerald-800/80 mt-0.5">
                    Tüm 400 sayfa, çizimler, sayfa düzenleri ve kayıtlı görselleriniz otomatik korunur.
                  </p>
                </div>
              </div>

              {/* Bu Cihazın Defter Eşleştirme Kodu */}
              <div className="flex flex-col gap-1.5">
                <span className="font-bold text-slate-700">Ajanda Eşleştirme Kodunuz (Diğer Cihazlar İçin)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={activeNotebookKey || cloudUser?.uid || 'Hazırlanıyor...'}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 font-mono text-[11px] text-slate-800 select-all outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const code = activeNotebookKey || cloudUser?.uid;
                      if (code && navigator.clipboard) {
                        navigator.clipboard.writeText(code);
                        showGalleryToast('Eşleştirme kodu kopyalandı');
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold flex items-center gap-1.5 transition shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Kopyala</span>
                  </button>
                </div>
              </div>

              {/* Başka Cihazdaki Ajandayı Bağlama */}
              <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                <span className="font-bold text-slate-700">Başka Cihazdaki Ajandanızı Açın</span>
                <p className="text-[11px] text-slate-500">
                  Diğer cihazınızdaki eşleştirme kodunu buraya girerek ajandanızı bu cihaza getirebilirsiniz:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={syncCodeInput}
                    onChange={(e) => setSyncCodeInput(e.target.value)}
                    placeholder="Eşleştirme kodunu yapıştırın..."
                    className="flex-1 px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-sky-500 font-mono text-[11px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!syncCodeInput.trim()}
                    onClick={() => {
                      const trimmed = syncCodeInput.trim();
                      if (!trimmed) return;
                      setActiveNotebookKey(trimmed);
                      setSyncCodeInput('');
                      showGalleryToast('Ajanda bulut hesabıyla bağlandı');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold transition shrink-0"
                  >
                    Bağlan
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
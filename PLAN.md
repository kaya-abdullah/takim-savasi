# Mustafa'nın Oyunu: "Takım Savaşı 3D" Detaylı Plan

Kaynak: Mustafa'nın ses kaydı (19.36.34). Transkript özeti:
oyuncu tek karakter, silah oyunu, mavi ve kırmızı takım, her takım 10 kişi,
herkesin başlangıç silahı var, haritada binalar var, sağ altta MAĞAZA tuşu,
mağazada 10 silah, her öldürme para kazandırır, bütün silahlar 7000 TL,
açılışta OYNA ekranı.

Kullanıcı kararları (2026-11-15):
- Ekonomi: silahlar 7000 TL kalır, öldürme ödülü artırılır + maç bonusu.
- Görünüm: 3D üçüncü şahıs (omuz üstü kamera).
- Takımlar: Mavi = oyuncu + 9 bot, Kırmızı = 10 bot (10'a 10).
- Teslim: APK Google Drive ana klasörüne.

## 1. Teknik Mimari

| Katman | Seçim | Neden |
|---|---|---|
| Dil | TypeScript (strict) | Tip güvenliği, hata azaltır |
| 3D motor | Three.js | Olgun, mobil WebGL2'de hızlı, PBR + gölge + post-process |
| Derleme | Vite | Hızlı geliştirme ve tek dosya üretim çıktısı |
| Mobil paket | Capacitor 7 | Aynı kod Android (APK) ve iOS (Xcode projesi) |
| Kayıt | localStorage (WebView içinde kalıcı) | Para, silahlar, ayarlar |
| Ses | WebAudio ile sentezlenmiş sesler | Harici dosya yok, telif riski yok |
| Test | Vitest (birim) + Playwright (uçtan uca) + Android emülatör | Mantık, tarayıcı ve gerçek APK testi |

Tüm grafik varlıkları kodla üretilir (prosedürel geometri ve canvas dokuları).
Harici model veya telifli varlık kullanılmaz.

Fizik: zemin düz olduğu için 2.5D çarpışma yeterli. Statik engeller eksen
hizalı kutu (AABB), karakterler daire (yatay) + yükseklik. Mermiler anlık ışın
(hitscan), roket ve el bombası benzeri silahlar mermi nesnesi.

### Klasör yapısı

```
src/
  main.ts              giriş, ekran yöneticisi
  core/                döngü, girdi, kayıt, ses, ayarlar
  game/                Match, Player, Bot, Weapon, Projectile, Economy
  world/               harita üretimi, binalar, gökyüzü, ışık, nav-grid
  render/              karakter modeli, efektler, post-process, kalite
  ui/                  menü, HUD, mağaza, maç sonu, sanal joystick
  data/weapons.ts      10 silah + başlangıç silahı tanımları
tests/                 vitest birim testleri
e2e/                   playwright testleri
android/ ios/          Capacitor projeleri
```

## 2. Oyun Tasarımı

### Akış
1. **Açılış ekranı**: oyun adı, büyük **OYNA** tuşu, MAĞAZA tuşu (sağ alt),
   Ayarlar, sağ üstte para. Arkada dönen 3D harita görüntüsü.
2. **Maç**: Takım Ölüm Maçı. 10'a 10. İlk 60 öldürmeye ulaşan takım ya da 5
   dakika sonunda önde olan kazanır.
3. **Maç sonu**: kazanan takım, oyuncu skoru (öldürme/ölüm), kazanılan para,
   "Tekrar Oyna" ve "Ana Menü".

### Ekonomi
- Her öldürme: **+200 TL**
- Maç kazanma bonusu: **+1000 TL**, kaybetme: **+300 TL**
- Her silah: **7000 TL** (Mustafa'nın kuralı)
- Ortalama maçta ~10 öldürme: 2000 + 1000 = 3000 TL. 2-3 maçta bir silah.
- Ekranda öldürme anında "+200 TL" animasyonu.

### Silahlar
Başlangıç silahı ücretsiz. Mağazada 10 silah, her biri 7000 TL.

| # | Ad | Tür | Hasar | Atış/sn | Şarjör | Özellik |
|---|---|---|---|---|---|---|
| 0 | Tabanca (başlangıç) | yarı otomatik | 22 | 4 | 12 | ücretsiz |
| 1 | Şimşek SMG | otomatik | 14 | 12 | 30 | hızlı, kısa menzil |
| 2 | Kartal Tüfek | otomatik | 24 | 8 | 30 | dengeli |
| 3 | Fırtına Pompalı | pompalı | 9 x 8 saçma | 1.2 | 6 | yakın mesafe |
| 4 | Şahin Keskin Nişancı | sürgülü | 95 | 0.8 | 5 | dürbün (zoom) |
| 5 | Ayı LMG | otomatik | 20 | 10 | 80 | büyük şarjör, yavaş yürüme |
| 6 | Üçlü Atış | 3'lü seri | 26 | 3 seri | 24 | isabetli |
| 7 | Kobra Revolver | yarı otomatik | 55 | 2 | 6 | güçlü tabanca |
| 8 | Kasırga Minigun | otomatik | 12 | 20 | 150 | ısınma süresi |
| 9 | Volkan Roketatar | mermi | 120 alan | 0.7 | 4 | alan hasarı |
| 10 | Plazma Tüfeği | otomatik | 30 | 6 | 40 | parlayan enerji mermisi |

Mağaza: kart ızgarası, her kartta 3D önizleme ikonu, istatistik çubukları
(hasar, hız, menzil, şarjör), SATIN AL / KUŞAN. Parası yetmeyen kart soluk.
Maç içinde mağaza açılınca oyun durur (tek oyunculu).

Botlar maç başında silah havuzundan rastgele silah alır (çeşitlilik için).

### Kontroller (mobil, yatay ekran)
- Sol alt: sanal joystick (yürüme).
- Sağ yarı ekran: sürükleyerek bakış.
- Sağ: büyük ATEŞ tuşu, NİŞAN (zoom), ŞARJÖR, ZIPLA, SİLAH DEĞİŞTİR.
- Sağ alt köşe: **MAĞAZA** tuşu.
- Hafif nişan yardımı (aim assist), mobilde oynanabilirlik için.
- Masaüstü test için: WASD, fare, sol tık, R, Space, B (mağaza).

### HUD
Sağlık çubuğu, mermi sayacı, skor tablosu (Mavi X - Y Kırmızı), süre,
öldürme akışı (sağ üst), mini harita (sol üst), vuruş işareti, hasar yönü
göstergesi, ölünce 3 sn yeniden doğma sayacı, para.

### Harita: "Liman Şehri"
- 140 x 100 m şehir bölgesi. Mavi üs batıda, kırmızı üs doğuda.
- 14-18 bina: farklı yükseklik, pencereli cephe dokusu, çatı detayları.
- Ortada meydan, ana cadde, ara sokaklar (pusu ve yan yollar).
- Siper: konteyner, araba, beton blok, varil, kum torbası.
- Ağaçlar, sokak lambaları, bayraklar (takım renkleri).
- Simetrik yerleşim, iki takım için adil.

### Botlar (yapay zeka)
Durum makinesi: DOLAŞ, SALDIR, KOVALA, YENİDEN DOLDUR.
- Navigasyon: 1 m'lik ızgarada A*, yol önbelleği.
- Görüş: görüş açısı 110°, menzil 60 m, engellere ışın testi.
- Tepki süresi 0.25-0.6 sn, isabet sapması mesafeyle artar.
- Çatışmada yana kayma (strafe), arada mermi doldurma.
- Hedefe öncelik: en yakın görünen düşman.
- Botlar dağılsın diye hedef noktalar: meydan, sokaklar, düşman üssü.

## 3. Grafik Kalitesi

- Fiziksel tabanlı malzeme (MeshStandardMaterial), ACES ton eşleme, sRGB.
- Güneş ışığı + yumuşak gölgeler (PCFSoft), yarım küre ortam ışığı.
- Gradyan gökyüzü + güneş parıltısı, mesafe sisi.
- Bloom (parlama) efekti: namlu ateşi, plazma, patlama.
- Prosedürel dokular: asfalt, kaldırım, bina cepheleri (pencere ışıkları).
- Karakterler: yuvarlak hatlı stilize asker (kask, yelek, takım rengi),
  prosedürel yürüme, koşma, nişan ve ölüm animasyonu.
- Efektler: namlu ateşi, mermi izi, kıvılcım, duman, patlama, kovan.
- Kamera: omuz üstü, yumuşak takip, ateşte hafif sarsıntı.
- Kalite ayarı: Düşük / Orta / Yüksek, açılışta cihaza göre otomatik.
- Performans hedefi: orta seviye Android'de 60 fps, < 150 çizim çağrısı
  (statik geometri birleştirme, örnekleme).

## 4. Uygulama Adımları

1. Proje iskeleti: Vite + TS + Three.js, ESLint, Vitest, Playwright.
2. Veri ve mantık: silahlar, ekonomi, kayıt, maç kuralları (birim testli).
3. Dünya: harita üretimi, çarpışma kutuları, nav-grid, ışın testi (testli).
4. Render: gökyüzü, ışık, dokular, post-process, kalite seviyeleri.
5. Karakter modeli ve animasyon.
6. Oyuncu kontrolü, kamera, girdi (dokunmatik + klavye/fare).
7. Silah sistemi, mermiler, hasar, ölüm, yeniden doğma.
8. Bot yapay zekası.
9. Arayüz: açılış, HUD, mağaza, maç sonu, ayarlar.
10. Ses efektleri.
11. Testler: birim, Playwright (menü, maç, mağaza, satın alma, hata yok).
12. Capacitor: Android projesi, yatay ekran, tam ekran, ikon, açılış ekranı.
13. İmzalı release APK, emülatörde kurulum ve test (logcat'te hata yok).
14. iOS projesi oluşturulur (Mac'te Xcode ile derlenmek üzere).
15. APK Google Drive ana klasörüne yüklenir, link bildirilir.

## 5. Kabul Kriterleri

- `npm run test` ve `npm run e2e` geçer, konsolda hata yok.
- Oyun açılır, OYNA ile maç başlar, 20 karakter savaşır.
- Öldürme para kazandırır, mağazada 7000 TL ile silah alınır ve kuşanılır.
- Kayıt uygulama kapanıp açılınca korunur.
- Maç sonu ekranı doğru kazananı gösterir.
- APK emülatörde açılır, 30+ fps, JS hatası yok.

## 6. Riskler

- iOS derlemesi Mac + Xcode gerektirir. Bu makinede yalnız Android APK.
- WebView performansı: kalite ayarları ve otomatik düşürme ile yönetilir.
- JDK 25 Gradle ile uyumsuz olabilir. Gerekirse JDK 21 kullanılır.

## 7. Sürüm 2 (2026-11-15)

Kullanıcı isteği: karakterler daha pürüzsüz, görüntü kalitesi üst düzey,
fiyatlar özelliklere göre kademeli ve daha ulaşılabilir, el bombası ve bıçak.

- Fiyatlar (güçlüye doğru artan): SMG 1.500, Revolver 2.000, Pompalı 2.500,
  Üçlü Atış 3.000, Tüfek 3.500, LMG 4.500, Keskin Nişancı 5.500,
  Plazma 6.500, Minigun 8.000, Roketatar 10.000 TL.
- Ödüller: leş 200 TL, kafadan +50, bıçakla +100. Seri bonusları:
  3 leş +100, 5 leş +250, 7 leş +500, 10 leş +1.000 TL.
- El bombası: her doğuşta 3 adet, basılı tut → yörünge önizlemesi, bırak → at.
  2,2 sn fünye, 5,5 m patlama alanı, sekme fiziği. Botlar da atar.
- Bıçak: herkeste var, önden 55 hasar, arkadan tek vuruş.
- Ekipman: Bomba Çantası (+1/+2 bomba), Çelik Yelek (+25/+50 can).
- Can yenilenmesi: 4 sn hasar almazsan saniyede 15 can.
- Grafik: yuvarlak, detaylı karakter modeli; takım renginde kenar ışığı;
  4x MSAA; telefonlarda 2x çözünürlük; daha keskin gölgeler.

## 8. Sürüm 4 (2026-11-16)

Kullanıcı istekleri ve uygulanan karşılıkları:

| İstek | Uygulama |
|---|---|
| Yapay zekayı öldürmek çok zor olsun | Botlar Zor'da 170, Çok Zor'da 250 can (iki takımda da, denge korunur). Vurulunca yana kaçar, uzakta eğilerek ateş eder, canı azalınca geri çekilir. Ayarlar → Zorluk (varsayılan Zor). Son vurulan düşmanın can çubuğu ekranda. |
| Eğilme tuşu | C / Ctrl veya dokunmatik EĞİL. Daha küçük hedef, %35 daha isabetli atış, yarı hız. Zıplama tuşu ayağa kaldırır. |
| Araba 30.000 TL, helikopter 50.000 TL | Mağaza → ARAÇLAR. Maçta T/Y veya 🚗/🚁 butonu ile çağır ve bin, X / BİN-İN ile in. Araba: düşman ezer, camdan ateş. Helikopter: makineli top + roket (G), ▲/▼ ile yüksel/alçal, çatılara iner. Araç vurulursa patlar, sürücü fırlar; 30/40 sn sonra yeniden çağrılır. |
| Kazanınca 1.400 TL | Galibiyet bonusu 1.400 TL. |
| Kaybedince 400 TL kaybetsin | Yenilgi cezası 400 TL (bakiye sıfırın altına inmez). Rakip öndeyken maçtan çıkmak da yenilgi sayılır. |
| Binaların içi, çatıya çıkma | Her yarıda 3, toplam 6 girilebilir bina: 2 kat, pencereler, merdiven, çatı. Botlar da kullanır. |
| Yer altı | Ana caddenin altında metro: 4 merdivenli giriş, iki koridor, sütunlu istasyon salonu. |

Teknik: zemin düzlemine açıklıklar (pit), kat başına nav ızgarası + merdiven bağlantıları
(NavWorld), araçlar Match simülasyonunda (birim testli), yeni e2e: v4.spec, v4phone.spec, play.spec.

## 9. Sürüm 4.1 (2026-11-16)

İstekler: ışıkların yanıp sönmesi, karışık sesler, daha detaylı binalar ve grafikler, silah satışı.

- Yanıp sönme: oda içinde otomatik silahla ateş ederken namlu ışığı her mermide 40 şiddetle yanıp sönüyordu
  (ölçüm: ekran parlaklığı kare başına 90/255 sıçrıyordu). Artık ateş sürdükçe yumuşak sabit parıltı (sıçrama < 3).
  Pencere/kapı çerçeveleri duvarla aynı düzlemdeydi (z-fighting); artık hep çıkıntılı. Gölge haritası 2 karede bir
  yenilenirken güneş her kare kayıyordu; artık yalnız yenileme karelerinde ve ışık düzleminde texel'e oturtularak.
- Ses: silah sesi için ses sınırı (yakın 9, orta 6, uzak 3), uzak sesler boğuk ve yankısız, yankı azaltıldı.
- Grafik: normal haritalı doku seti (tuğla, sıva, parke, seramik, metro fayansı, granit, beton, kumaş, metal),
  odalara işlenmiş lamba ışığı ve köşe gölgesi (vertex bake), çift katmanlı duvarlar (dış tuğla, iç sıva),
  çerçeveli camlı pencereler, süpürgelik, korkuluk, mobilya (masa, sandalye, raf, tezgâh, kanepe, yatak, masa+monitör,
  bitki, tablo, halı, avize), çatıda klima/depo/anten, metroda bank, otomat, çöp kutusu, afiş, kablo kanalı.
  Sokakta yuvarlatılmış park arabaları, asfalt kabartması, yangın musluğu, çöp kutusu, bank, baba, trafik lambası.
- Satış: mağazada alınan silah ve araçlar %70'e satılır (iki dokunuşla onay). Başlangıç tabancası satılamaz.
- Testler: e2e/visual.spec.ts (her mekânın ekran görüntüsü + parlaklık, yürürken titreşim, dururken kararlılık,
  ateşte yanıp sönme), satış testleri.

## 10. Sürüm 4.2 (2026-11-16)

İstekler: ekranın ortasındaki parlayan ışık, şelale (havuz) ve süs arabalarının kaldırılması, metro girişlerinin
kaldırıma taşınması, hataların düzeltilmesi.

- Parlama: meydan ortasındaki havuzun suyu ayna gibiydi (pürüzlülük 0.05) ve güneşi parlak bir leke olarak
  yansıtıyordu. Havuz kaldırıldı; heykel yere bir kaide ile oturuyor. Doğuş kalkanı artık saniyede 3 kez nabız gibi
  atmıyor: sabit renk, son yarım saniyede söner.
- Süs arabaları (caddede 8 park arabası) kaldırıldı. Satın alınan araba ve helikopter aynen duruyor.
- Metro: batı girişi ana caddenin ortasındaydı. Artık güney kaldırımında (x -38, ara sokak köşesi), merdiven inince
  caddenin altından kısa bir geçitle koridora bağlanıyor; aynası doğuda kuzey kaldırımında. Meydan girişi yerinde.
  Her girişin açık ucuna araba geçmesin diye bir baba konuldu (yaya iki yanından geçer).
- Hatalar: araba açık merdiven ağzından metroya inebiliyordu (baba ile düzeldi). Yeni korkuluk ile cadde bariyeri
  arasında araba sıkışıyordu (bariyer şeride alındı). Korkuluklar siyah dolu blok gibi görünüyordu; artık dikme,
  küpeşte ve ara lama (çarpışma kutusu görünmez).

## 11. Sürüm 4.3 (2026-11-16)

- Yolun ortasındaki yanıp sönme (v4'ten beri vardı): metro salonu ve koridorlarının tavanı caddenin hemen altında,
  üst yüzü tam yol seviyesindeydi (y = 0). İki yüzey aynı pikseller için yarıştı (z-fighting), uzaktaki yolun ortası
  yürürken titreşti. Yer altındaki her parçanın üstü artık yolun 2 cm altında. Ölçüm (cadde ortası, yürürken):
  %3,92 → %0,003 titreşen piksel. Testler: v4.test.ts (yol seviyesinde üst yüz yok), visual.spec.ts (cadde ortası).
- Patlama ışığı yumuşatıldı: tepe şiddeti 30 → en çok 6, mesafeyle azalır, 35 m ötede hiç yanmaz.

## 12. Sürüm 4.4 (2026-11-16)

İstek: insanlar gerçeğe çok yakın olsun.

- Karakterler artık gerçekçi, kemikli ve dokulu bir asker modeli (Mixamo "Vanguard", three.js örneklerindeki
  Soldier.glb; Adobe Mixamo içerikleri oyunlarda telifsiz kullanılabilir). 11 bin üçgen, renk + normal haritası.
- Takım renkleri: zırh plakaları dokuda takım rengine boyanır (mavi / kırmızı), çizikler ve gölgeler korunur.
- Animasyon: kendi 13 kemikli iskeletimiz (yürüme, koşu, eğilme, nişan, şarjör, bıçak, bomba, ölüm) aynen çalışır;
  pozu her karede askerin iskeletine aktarılır (dünya uzayında dönüş + kalça yüksekliği). İki kemikli IK ile sağ el
  kabzaya, sol el namlu altına oturur (tabancada iki el kabzada). Adım açıklığı gerçekçi hale getirildi.
- Performans: dönüşler hiyerarşide biriktirilir (matris güncellemesi yok), IK yalnız 25 m içinde, 30 m ötede poz
  iki karede bir. 20 asker: karakter güncellemesi 0,49 ms/kare. Model yüklenemezse eski figür kullanılır.
- Test: e2e/human.spec.ts (model yüklü, eller silahta, boy, takım dokusu, eğilme, yedek figür).

## 13. Sürüm 4.5 (2026-11-16)

- Nişangâh kendi kendine kayıyordu: nişan yardımı (varsayılan açık) fare kullanılırken de çalışıyor ve nişangâhın
  6° yakınındaki düşmana görüşü kendiliğinden çekiyordu (ölçüm: fareye dokunmadan 2 saniyede 10,3°). Artık fareyle
  nişan yardımı yok; dokunmatikte yalnız ateş ederken veya parmakla nişan alınırken çalışır, boşta görüş hiç kaymaz.
  Ayar adı: "Nişan yardımı (dokunmatik)". Test: e2e/aim.spec.ts (fare 0°, dokunmatik boşta 0°, ateşte çekim var).

## 14. Sürüm 4.6 (2026-11-17)

İstek: araba geçebilsin diye yollar açılsın; barikatlar, ortadaki büyük şey kaldırılsın.

- Yollardan kaldırılanlar: 6 barikat, meydandaki heykel, caddedeki kum torbaları, ara sokaklardaki 2 konteyner,
  3 sandık ve 1 varil (aynalarıyla birlikte toplam 23 engel). Meydandaki beton duvarlardan biri de kaldırıldı.
- Meydanın metro girişleri kuzey-güney sokağının ortasındaydı; sokağın doğusuna, meydan kenarına taşındı (x 5..8).
- Meydan babaları artık sokağın üstünde değil.
- Testler: hiçbir yolda engel, korkuluk veya merdiven ağzı yok; araba caddeyi iki yönde ve üç ara sokağı baştan
  sona çarpmadan sürüyor (eski haritada caddede 57 m'de barikata çarpıyordu); hiçbir eşya merdiven ağzında değil.

## 15. Sürüm 4.7 (2026-11-18)

İstek: araba ve helikopter kalksın, yerine tank ve savaş uçağı gelsin; fiyatlar aynı kalsın; uçak biraz büyük,
tank biraz daha küçük bomba atsın.

- Araba → Savaş Tankı (30.000 TL, 800 can, en hızlı 12 m/s, olduğu yerde döner, düşmanı ezer). Ateş: makineli;
  G / bomba düğmesi: top mermisi (patlama 6 m, hasar 160, 2,5 sn bekleme). Taret ve namlu nişan yönüne döner.
- Helikopter → Savaş Uçağı (50.000 TL, 650 can, 30 m/s, dikine kalkış ve çatıya iniş). Ateş: uçak topu;
  G / bomba düğmesi: bomba (patlama 9 m, hasar 220, 3 sn bekleme). Bomba hiç yukarı gitmez, uçağın hızını taşır.
- Eski kayıtlar: satın alınmış araba tanka, helikopter uçağa dönüşür.
- Yeni modeller (tank: palet, tekerlek, dönen taret; uçak: delta kanat, çift dikey kuyruk, art yakıcı alevi,
  katlanan iniş takımı), motor sesleri, mağaza simgeleri, HUD yazıları, mini haritada T / U.
- Testler: tankın makinelisi ve top mermisi, uçak bombası aşağı gidiyor, bomba tank mermisinden büyük, eski kayıt
  dönüşümü; e2e tank/uçak (masaüstü ve telefon) güncellendi.

## 16. Sürüm 4.8 (2026-11-18)

İstek: uçak bombayı alta doğru atsın.

- Uçak bombası artık nişangâha doğru gitmez; uçağın tam altından dümdüz aşağı düşer (ilk hız 14 m/s, yerçekimi
  20 m/s²; 13 m'den 0,67 sn'de yere iner) ve uçağın hızını taşımaz. Patlama alanı (9 m) ve hasar (220) aynı.
- Test: nişangâh ileri bakarken bile bomba yatay hızsız, uçağın x/z konumundan aşağı doğru çıkıyor.

## 17. Sürüm 5.0 (2026-11-19)

İstek: bütün grafikler gerçekçi olsun (GTA 6 gibi).

Not: GTA 6 yüzlerce kişilik ekip ve konsol donanımıyla yapılıyor. Bu oyun telefon tarayıcısında (WebGL) çalışıyor.
Hedef: aynı görsel dilin (sinematik ışık, ıslak asfalt, gerçekçi bitki örtüsü, eskimiş yüzeyler) telefonda 60 fps
çalışan bir karşılığı.

- Renk derecelendirme: ACES üstüne film eğrisi, soğuk gölge / sıcak parlak alan, hafif doygunluk. Her malzemenin
  kendi gölgelendiricisinde çalışır (CustomToneMapping), telefonda ek geçiş maliyeti yok.
- Gökyüzü: Rayleigh benzeri mavi geçiş, güneş çevresinde Mie parıltısı, güneş diski, yavaşça kayan hacimli bulutlar
  (fbm, güneş tarafından aydınlatılmış). Ufuk sis rengine karışır, uzak binalar dikişsiz kaybolur.
- Işık: ikindi güneşi (daha uzun gölge, sıcak ışık), ortam ışığının çoğu gökyüzü ortam haritasından; üstel sis.
- Zemin: 16 piksel/m; beton kaldırım plakaları, eskimiş asfalt, lastik izleri, yamalar, çatlaklar, yağ lekeleri,
  rögar kapakları, ızgaralar, aşınmış şerit boyası, meydanda granit parke halkaları. Su birikintileri ayrı
  pürüzlülük haritasıyla ayna gibi, gökyüzünü yansıtır.
- Cepheler: 1024 piksel dokular, normal haritası (gömme pencere, çıkıntılı çerçeve, denizlik, tuğla sırası),
  cam yansıtır (pürüzlülük + metallik haritası), perde, jaluzi, klima, yağmur izi, zemin kiri.
- Ağaçlar: eğik, incelen gövde ve dallar, kabuk dokusu, ağaç başına 120 yaprak kartı (alfa testi, gölge düşürür),
  taç biçimli normaller ile hacimli ışık, rüzgârda salınım; saksılarda toprak ve çalı.
- Kum torbaları: yastık biçimli, kumaş dokulu, her biri hafif yamuk.
- Askerler: takım renkleri askeri tonlara çekildi (lacivert / bordo), parlak kenar ışığı azaltıldı.
- Kamera: CSS vinyet (her kalitede), Yüksek'te ince film greni ve kenarlarda hafif renk sapması.
- Ölçüm: masaüstünde 60 fps (Yüksek, 20 asker). Dünya kurulumu 1,8 sn → 2,7 sn.
- Test: e2e/v5.spec.ts (derecelendirme, gökyüzü, sis, malzemeler, üç kalitede pozlama ve doygunluk, fps).
  Geliştirme için: scripts/shoot.mjs sabit noktalardan ekran görüntüsü alır.

## 19. Sürüm 5.2 (2026-11-19)

Kullanıcı v5.1'in insanlarını, yeleklerini, silahlarını ve duruşlarını beğenmedi. v5.0 görünümüne dönüldü
(Android sürüm kodu geri gidemediği için 5.2 adıyla). v5.1 çalışması `v6-people` dalında duruyor; yeni sürümde
gerçek hareket yakalama animasyonları, takım renginde kıyafet ve tutarlı gerçekçi silah seti hedefleniyor.

## 20. Sürüm 5.3 (2026-11-19)

İstekler: insanlar farklı yerlerde doğsun; harita 4 kat büyüsün ama her yer aynı olmasın; içine girilip
çıkılabilen uzun binalar; envanterde sadece 3 silah, sırtta çanta (silah değiştirirken çanta öne alınır, açılır,
ekranda bütün silahlar görünür); el bombası ve bıçak tuşu yerinde kalsın; bıçak fırlatılabilsin.

- Harita: 140 x 100 m → 280 x 200 m (4 kat alan). Eski şehir merkezi (metro, 6 bina) ortada aynen duruyor.
  Çevresinde çevre yolları ve 24 yeni blok var; her blok farklı türde ve kendi tohumuyla yerleşiyor: gökdelen
  meydanı, park (çim), liman (konteyner sıraları, çakıl), pazar (tezgâh sıraları), mahalle (farklı boy ve renkte
  evler), otopark (çizgili), sanayi (depo + avlu), spor sahası, akaryakıt deposu, han (3 katlı bina). Yan yana iki
  blok aynı türde değil. Zemin dokusu (çim, çakıl, otopark çizgisi, her kavşakta yaya geçidi) haritadan üretiliyor.
- Uzun binalar: 4, 5, 5, 5, 6 ve 7 katlı altı gökdelen ve 3 katlı iki han; hepsine girilir, her kata zikzak merdivenle
  çıkılır, çatıya kadar. Katlar daire, açık ofis veya depo olarak döşeli. Botlar her kata gider (kat başına nav).
- Doğma: sabit üs yok. İlk doğuşta her takım kendi yarısına dağılır, her maç başka yerler. Yeniden doğuş şehrin
  herhangi bir açık noktası: canlı düşmana en az 30 m, mümkünse düşmanın göremediği, çatışmaya çok uzak olmayan yer.
- Envanter: 3 el slotu (alt çubuk, 1-2-3 tuşları veya dokunma). Diğer silahlar sırttaki çantada. Silah tuşu
  (Q/Tab): asker çantayı omzunun üstünden öne alır, açar, kamera öne döner; sağda ÇANTA ekranı: üstte 3 slot,
  altta bütün silahlar. Slot seç, silaha dokun: o slota girer ve eline alırsın. Çanta açıkken ateş edilemez,
  yürünemez. Kapatınca çanta sırta döner. Maçta bulunan silahlar boş slota, yoksa çantaya girer; ikmal silahı
  eldeki slota. Slot düzeni kaydedilir.
- Bıçak: dokun = bıçakla vur (aynı). Basılı tut = bıçak elde kalkar, uçuş yayı görünür; bırak = fırlat. 75 hasar,
  kafaya isabet öldürür, öldürünce bıçak ödülü. Bıçak düştüğü yerden alınır ya da 8 sn sonra yenisi gelir; o
  sürede tuşta geri sayım var. Botlar da 4-13 m'de bıçak fırlatır.
- Mini harita oyuncuyu ortalayıp 120 m'lik pencere gösteriyor; ikmal haritanın dışındaysa kenarda.
- Testler: tests/v6.test.ts (blok çeşitliliği, şehre yayılan doğuş noktaları, güvenli yeniden doğuş, slot/çanta
  kuralları, çanta açıkken ateş yok, bıçak isabeti, kafadan öldürme, bıçağı geri alma); her binanın her katı
  merdivenden erişilebilir; e2e'de çanta ekranı ve bıçak fırlatma.

## 21. Sürüm 5.4 (2026-11-19)

İstekler: uçağın roketi alttan bırakılıp düşmana doğru gitsin; binaların içinde 50 can dolduran bandaj olsun.

- Uçak roketi (G / bomba tuşu): uçağın altından bırakılır, 0,3 sn düşer (uçağın tırmanışını almaz, hep
  aşağı başlar), sonra motoru yanar ve burnunu hızla çevirip nişangâha en yakın görünen düşmana kilitlenir
  (45°'lik koni, 170 m); hedef yoksa nişangâhın gösterdiği noktaya gider. Hız 60 m/s, patlama 9 m, hasar 220.
  Ateşlenince ekranda "ROKET KİLİTLENDİ: <isim>" ya da "ROKET ATILDI".
- Bandaj: girilen her binanın zemin katında ve her üst katında bir bandaj (çatılarda yok), toplam 50.
  Üstünden geçince +50 can (can doluysa alınmaz, sonraya kalır). Alınan bandaj 30 sn sonra yerine gelir.
  Yerde dönen bir sargı rulosu ve kırmızı halka; mini haritada kırmızı artı. Botlar canı %60'ın altındayken
  bandaja gider.
- Testler: roket önce düşer ve 8 m irtifadan bile hedefini vurur; her katta bandaj var ve yürünebilir yerde;
  bandaj 50 iyileştirir, can doluyken alınmaz, 30 sn sonra geri gelir.

## 22. Sürüm 5.5 (2026-11-20)
İstekler: yeleklerin en üst seviyesi 5 olsun; uçak roketi haritanın yarısına kadar atsın, uzaksa "çok uzak" yazsın.

- Çelik Yelek 5 seviye: 2.500 / 5.000 / 7.500 / 10.000 / 12.500 TL; her seviye +25 can (en üstte 225).
  Eski kayıtlar korunur (en fazla 5).
- Uçak roketi menzili haritanın yarısı (140 m; harita 280 m geniş). Nişangâhtaki düşman 140 m'den uzaksa
  ya da nişangâh 140 m içinde bir yere değmiyorsa (gökyüzü) roket atılmaz, bekleme süresi harcanmaz ve
  ekranda "ÇOK UZAK" yazar.
- Testler: yelek 5. seviyede 'max', can 225; 200 m'deki hedefe ve gökyüzüne roket atılmaz, 120 m'dekine
  atılır ve kilitlenir.

## 23. Sürüm 5.6 (2026-11-20)
İstek: binadaki bandajlar elimize gelsin.

- Bandajın üstünden geçince can dolmuyor, bandaj cebe giriyor (can dolu olsa da). En fazla 3 bandaj
  taşınır; 3 varken yerdeki bırakılır. Alınan bandaj 30 sn sonra yerine gelir. Ölünce cepteki bandajlar gider.
- Kullanmak: bilgisayarda H, telefonda sol ateş düğmesinin yanındaki kırmızı bandaj düğmesi (yalnız cepte
  bandaj varken görünür, üstünde sayı). 1,5 sn sarılır: karakter rulo bandajı sol eline alıp kolunu sarar,
  düğmede ilerleme halkası döner, bu sırada ateş edilmez, bıçak ve bomba kullanılmaz. Bitince +50 can.
- Can doluysa "CANIN ZATEN DOLU", bandaj yoksa "BANDAJIN YOK" yazar. Araçtayken kullanılmaz.
- Botlar: yoldaki bandajı alır, canı %60'ın altına inip 1,2 sn vurulmayınca sarar.
- Testler: cebe girer, en fazla 3, sarma süresince ateş yok ve sonra +50, bot sarıyor; tarayıcıda H ile ve
  telefonda düğmeyle sarma, düğme diğer kontrollerin üstüne binmiyor.

## 24. Sürüm 5.7 (2026-11-21)
İstek: ayarlara FPS ekle, en fazla 100 FPS olsun.

- Ayarlar'da "FPS sınırı" satırı: 30 / 60 / 100. Varsayılan 100; 100'ün üstü yok.
- Döngü bir zaman çizelgesiyle kısılıyor: 120/144 Hz ekranda 100 seçilince gerçekten ~100 FPS (60'a düşmez).
- Otomatik çözünürlük düşürme sınıra göre: 30 seçiliyken 30 FPS "yavaş cihaz" sayılmaz.
- Testler: 60/120/144/240 Hz ekranlarda sınır tutuyor, kayıtta geçersiz değer 100'e dönüyor; tarayıcıda
  30 seçilince döngü ≤32 FPS, ayar yeniden açılışta korunuyor.

## 25. Sürüm 5.8 (2026-11-21)
İstek: aynı anda oyuna girenler aynı odada olsun; bir takım dolunca diğer takıma girsinler.

- Menüde "ÇEVRİMİÇİ OYNA". Sunucu yok: cihazlar herkese açık Nostr röleleri üzerinden tanışır (trystero),
  oyun verisi WebRTC ile doğrudan cihazlar arasında akar. GitHub Pages'te çalışır, hesap gerekmez.
- Tek ortak oda (`p1-oda-1`). Odaya en önce giren cihaz ev sahibidir: botları, saati, eşyaları ve maç
  sonunu o yürütür. Ev sahibi çıkarsa en eski konuk devralır; botlar kaldığı yerden devam eder.
- Takım: insanlar önce maviyi doldurur (10 yer), mavi dolunca kırmızıya (10 yer) girer. İnsan olmayan yerde
  bot oynar; oyuncu çıkınca yerine yine bot geçer. 20 kişi dolunca sonraki oda (`oda-2`… en fazla 5).
- Herkes kendi askerini yürütür ve saniyede 12 kez durumunu yollar. Vuruşa ateş eden cihaz karar verir,
  canı kurbanın cihazı düşer ve ölümü herkese duyurur (skor, leş akışı, para herkeste aynı).
- El bombası, fırlatılan bıçak, bıçak darbesi, bandaj ve eşyalar (ikmal, can, bandaj) eşleniyor.
- Çevrimiçi maçta tank ve uçak kapalı (sonraki adım). Duraklatma menüsü maçı durdurmaz.
- Maç bitince ev sahibi 12 sn sonra herkese yeni maç başlatır. Arada katılan, süren maça girer.
- `?oda=isim` adresiyle özel oda (arkadaş grubu ve testler için).
- Testler: sahte ağla 20 kişi (mavi 1..9, kırmızı 10..19, 21. kişiye "dolu"), boşalan yer, ev sahibi
  devri, aynı anda açılan iki odanın birleşmesi, vuruş/ölüm yönlendirmesi; gerçek ağda üç tarayıcı
  (sıra, hareket, leş ve skor herkeste aynı, ev sahibi çıkınca botlar sürüyor).

## 26. Sürüm 5.9 (2026-11-21)
İstek: askerlerin üstünde isimleri yazsın, kendimize isim koyma bölümü olsun.

- Menüde sağ üstte "İSMİN" düğmesi: açılan pencereye isim yazılır (2–14 harf, Türkçe harfler olur;
  `< > & " ' \``, kontrol karakterleri ve fazla boşluk temizlenir). Kayıtta `name` olarak saklanır.
- İsim konmadan ÇEVRİMİÇİ OYNA'ya basılırsa önce bu pencere açılır. İsim tek başına oynarken de
  kullanılır (konmamışsa eskisi gibi MUSTAFA).
- Her askerin başında, takım işaretinin üstünde takım renginde isim etiketi (botlar dahil, kendi askerimizde
  yok). Duvarın arkasından görünmez, 55 m'den uzakta ve ölüyken gizlenir. Çevrimiçi isim değişince etiket
  yenilenir.
- Testler: isim temizleme ve kayıt; tarayıcıda isim yazma (WASD yazı olarak girer), 2 harften kısa
  reddedilir, yeniden açılışta korunur, maçta kullanılır, etiketler yakında görünür/uzakta gizli;
  çevrimiçi ilk girişte pencere açılır, karşı cihaz ismi askerin üstünde görür.

## 27. Sürüm 6.0 (2026-11-21)
İstek: haritanın her yerine metro girişi; orta sağdaki girişi kaldır; biri binince kalkan, haritanın her
çeyreğinde duran metro; oyun bazen kendiliğinden açılıyor, düzelt; bazı binalar arasında köprü.

- Tünel artık bulvarın altında şehrin bir ucundan öbürüne (x -136..136). 14 kaldırım girişi (her çeyrekte,
  bulvarın iki yanında) ve meydanın batısındaki merdiven. Meydanın doğusundaki (orta sağ) giriş kaldırıldı.
  Girişlerin üstüne denk gelen bina ve eşyalar haritadan çıkarılır.
- Metro treni: 14 m vagon, koridorun ortasındaki rayda. Duraklar x = -105, -35, 35, 105 (her çeyrekte bir).
  Durakta kapılar açık bekler; içeride biri 2 sn kalınca kapılar kapanır, sıradaki durağa gider (hızlanır,
  frenler, tam durakta durur), hat sonunda geri döner. Yolcular trenle taşınır; giderken içeriden çıkılmaz,
  yoldakiler kenara itilir. Durakta yalnızca kapılardan girilip çıkılır. İçindeyken vagon saydamlaşır.
  Çevrimiçi: treni ev sahibi yürütür, diğerleri izler; herkes kendi askerini taşır. Mini haritada görünür.
- Oyunun kendiliğinden açılması: çevrimiçi maç bitince ev sahibi 12 sn sonra herkesi yeni maça çekiyordu
  (sonuç ekranı ve mağaza kapanıyordu). Artık kimse çekilmez: TEKRAR OYNA'ya basan yeni maça girer. Ev sahibi
  sonuç ekranındayken biri TEKRAR OYNA derse oda ona devredilir (dönem numarasıyla eski ev sahibi geçersiz).
- Köprüler: merkezde 4 çatı köprüsü (batı evi ile meydan evi arasında ve doğu evinden bulvarın üstünden
  karşı eve; aynalı). Korkulukta geçit, korkuluklu beton köprü, botlar için çatıdan çatıya bağlantı.
- Kamera: dar koridorda duvar dibinde omuz kayması duvarın dışına taşıyordu; kısaltıldı, duvar payı dik
  ölçülüyor.
- Testler: tünel uçtan uca yürünür, her giriş sokaktan tünele iner, girişlerin üstü boş; tren binen olmadan
  beklemez, 2 sn sonra kalkar, tam durakta durur, hat sonunda döner, yolcuyu taşır, yoldakini iter;
  çevrimiçi konuğun treni ev sahibininkini izler; köprü yüksekliği, geçitler, bot yolu; maç sonu kimse
  çekilmez, devir. Tarayıcıda trene binip sonraki durağa gitme, girişten inme, köprüden geçme.

## 28. Sürüm 6.1 (2026-11-21)
- Hata: yavaş cihazda (20 FPS, kare başına 0,05 sn) yolcu vagon duvarına yürüyünce tek adımda "içeride"
  sınırını aşıp dışarı itiliyordu, yani yürüyen trenden kaçabiliyordu. Kapılar kapanınca yolcu listesi
  sabitleniyor; durağa kadar yolcu sayılıyor. Test: 20 FPS'te her karede duvara koşan yolcu trende kalıyor.

## 29. Sürüm 6.2 (2026-11-22)
İstek: metroya binince sadece içi görünsün; metronun üstündeki ve köprüdeki bozukluk; bazı şeyler iç içe giriyor.

- Trene binince vagon artık saydamlaşmıyor (tünel duvarların arkasından görünüyordu). Kamera vagonun içinde
  tutulur: omuz noktası ve kamera vagonun iç kutusuna sıkıştırılır. Aşağı bakınca kamera tavanı delip trenin
  üstüne çıkıyordu, bu da kalktı. Pencereler camlı kalır.
- Durak tabelası tavana yaslandı (tren tavanının 10 cm üstünde asılıydı).
- Trenden ışınlanan/yeniden doğan oyuncu yolcu listesinde kalıp trenle birlikte sürükleniyordu: yolcu sayılmak
  için vagonun yanında olmak gerekir (`Train.carrying`).
- Köprü: çatı korkuluğundaki geçidin üstünden taş başlık ve beyaz kapı kasası geçiyordu; artık temiz bir kesik.
- İç içe: köprülerin altındaki 4 ağacın tepesi köprüden, 6 ağacın tepesi bina duvarından geçiyordu; bu ağaçlar
  yerleştirilmez.
- Testler: kamera her bakışta vagonun içinde ve tavanın altında; trenden uzaklaşan sürüklenmez; geçitte başlık
  yok; hiçbir ağaç köprüye/duvara girmiyor.

## 30. Sürüm 6.3 (2026-11-22)
İstek: bazı şeyler evin duvarından geçiyor; metro kapısının önündeki bankları kaldır.

- Duvara yaklaşan askerin silahı ve elleri duvarın içinden görünüyordu. Göğüs hizasında öne (ve silah tarafına)
  1,15 m ışın atılır; duvar yakınsa asker silahı namlu yukarı göğsüne çeker (kollar IK ile silahı izler).
  Kameradan 40 m ötedeki askerlerde ölçülmez.
- 4 eşya noktası (can/hasar/hız, hava ikmali) bina içine denk geliyordu; binalara 1,5 m'den yakın noktalar atılır.
- Duraklarda tren kapılarının önündeki 16 bank kaldırıldı (orta salondaki iki bank duruyor).
- Testler: hiçbir eşya noktası binada değil; kapı önleri boş.

## 31. Sürüm 6.4 (2026-11-22)
- Hata: doğudaki (x = 38, kuzey) metro girişinin tabelası yanındaki evin duvarına girmişti. Tabela merdivenin
  bina olmayan yanına konur. Test: hiçbir metro tabelası bir binanın içinde ya da 30 cm yakınında değil.

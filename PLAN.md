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

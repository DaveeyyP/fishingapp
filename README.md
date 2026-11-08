# Horgász Bíró – horgászverseny-eredmények

Két részből áll:

- **Bírói Android app** (`android/`): ebben rögzíti a bíró a szektorokat, a boxokat, a csapatokat és a fogott halakat. Az app kiszámolja az össztömeget, a Big Fish-t és a helyezést. Internet nélkül is működik, és amint van kapcsolat, feltölti az adatokat.
- **Néző oldal** (`viewer/`): ezt nyitják meg a versenyzők a linkről, böngészőben, telepítés nélkül. Magától frissül.

A kettőt egy ingyenes **Firebase Realtime Database** köti össze.

---

## 1. Firebase beállítása (egyszer, kb. 10 perc)

1. Nyisd meg a https://console.firebase.google.com oldalt, és jelentkezz be a Google-fiókoddal.
2. **Projekt létrehozása** (Create a project). Adj neki nevet, pl. `horgasz-biro`. A Google Analytics nem kell, kikapcsolhatod.
3. A bal oldali menüben: **Build → Realtime Database → Create database**
   - Helynek válaszd a **Belgium (europe-west1)** lehetőséget.
   - Indítsd **zárolt módban** (Start in locked mode).
   - A fenti cím (pl. `https://horgasz-biro-default-rtdb.europe-west1.firebasedatabase.app`) lesz az **adatbázis címe**. Másold ki.
4. Ugyanitt nyisd meg a **Rules (Szabályok)** fület. Töröld ki, ami ott van, másold be a `firebase/database.rules.json` fájl tartalmát, és nyomd meg a **Publish** gombot.
   - Így bárki *olvashatja* az eredményeket, de *írni* csak a bejelentkezett bíró tud.
5. **Build → Authentication → Get started**
   - A **Sign-in method** fülön kapcsold be az **Email/Password** módot.
   - A **Users** fülön az **Add user** gombbal hozd létre a bíró fiókját (e-mail + jelszó). Ezzel fogsz belépni az appba.
   - A **Settings → User actions** résznél vedd ki a pipát az **Enable create (sign-up)** elől. Így idegen nem tud magának fiókot csinálni.
6. Bal fent a fogaskerék: **Project settings → General**. Itt találod a **Web API Key** értékét (`AIza…` kezdetű). Másold ki.
   - Ha ott még nincs kulcs, lejjebb kattints a `</>` (Web app) ikonra, regisztrálj egy appot bármilyen névvel, és a megjelenő kódból másold ki az `apiKey` értékét.

## 2. Az app elkészítése – A) GitHub segítségével (nem kell hozzá program a gépedre)

1. Csinálj egy ingyenes fiókot a https://github.com oldalon.
2. Hozz létre egy **New repository**-t `horgasz-biro` néven, **Public** beállítással.
3. A repository oldalán kattints az **uploading an existing file** linkre. Húzd be a kicsomagolt mappa **teljes tartalmát**, majd nyomd meg a **Commit changes** gombot.
   - Ellenőrizd, hogy a `.github/workflows/build.yml` fájl is feltöltődött-e (Mac-en a ponttal kezdődő mappák rejtve vannak). Ha hiányzik: **Add file → Create new file**, névnek írd be: `.github/workflows/build.yml`, és másold bele a fájl tartalmát.
4. **Settings → Pages → Source:** válaszd a **GitHub Actions** lehetőséget.
5. Az **Actions** fülön elindul az építés (kb. 5 perc). Ha piros lett, mert a Pages-t csak utána kapcsoltad be: **Build → Run workflow**.
6. Ha zöld lett, két címed lesz (a `FELHASZNALONEV` a te GitHub-neved):
   - **Néző oldal:** `https://FELHASZNALONEV.github.io/horgasz-biro/`
   - **APK letöltés:** `https://FELHASZNALONEV.github.io/horgasz-biro/HorgaszBiro.apk`
7. A bíró telefonján nyisd meg az APK-linket, töltsd le, és telepítsd. Az Android megkérdezi, hogy engedélyezed-e a „telepítést ismeretlen forrásból”: engedélyezd.

Ha később módosul a kód, töltsd fel újra a fájlokat. Az új APK telepíthető a régire, az adatok megmaradnak.

## 2. Az app elkészítése – B) Android Studióval

1. Telepítsd az Android Studiót, és nyisd meg benne az `android` mappát.
2. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. A kész fájl helye: `android/app/build/outputs/apk/`.
3. A néző oldalt ilyenkor máshol kell közzétenni. A legegyszerűbb: https://app.netlify.com/drop – húzd rá a `viewer` mappát, és kapsz egy címet.

## 3. Az app beállítása (első indításkor)

Az appban a jobb felső **⚙** gombra kattintva:

1. **Adatbázis címe:** az 1/3. pontban kimásolt cím.
2. **Web API kulcs:** az 1/6. pontban kimásolt kulcs.
3. **Néző oldal címe:** pl. `https://FELHASZNALONEV.github.io/horgasz-biro/`
4. **Mentés**, utána **Bejelentkezés** a bíró e-mail címével és jelszavával.

Ezután bármelyik versenynél a **🔗 Link** gombbal megkapod a linket a versenyzőknek. A **Megosztás** gombbal mehet egyenesen Viberre, WhatsAppra vagy SMS-ben.

## Jó tudni

- A tömeget tizedesvesszővel vagy ponttal is beírhatod (`6,375` vagy `6.375`).
- A **helyezés** szektoronként az össztömeg alapján számolódik. Ha az össztömeg egyenlő, a nagyobb hal dönt.
- **Big Fish:** többnapos versenynél a verseny Beállítások fülén add meg a napokat vagy időszakokat. A Fogások fülön választod ki, melyik időszak fut éppen. Minden időszaknak külön Big Fish-e lesz, plusz a verseny legnagyobb hala.
- Az ingyenes Firebase csomag kb. **100 nézőt** tud egyszerre élőben kiszolgálni. Ha ennél többen nézik, a néző oldal magától átvált 15 másodpercenkénti frissítésre.
- A `shared/` mappában van a közös kód (számítások, kinézet). Ha ezt módosítod, futtasd a `sync-shared.sh` szkriptet. GitHubon ezt az építés magától elvégzi.

# Urban veri sözleşmesi

Bu değişiklikler yalnızca Urban içindir. Proto'nun MQTT alan sırası, HTTP adları ve CSV şeması değişmez. Sunucudaki Ayarlar sayfasında aktif araç ve kanal seçilir; Urban göndermeden önce **Urban + HTTP** veya **Urban + MQTT** seçilmelidir.

## Arayüz ve alanlar

- Yakıt hücresi kadranlarının ibreleri yalnızca `fv`, `fa`, `fw` ile hareket eder. Alt değerler solda Fuel Cell, sağda EYS olacak şekilde `38.74V / 52.21V` biçimindedir. EYS alanları: `eysv`, `eysc`, `eysw`.
- `oran`: doğrudan yüzde değeri; örneğin `65.25` → `65.25%`. Sunucu değeri 100 ile çarpmaz.
- `flow`: araçtan hazır gelen **toplam akış**; örneğin `12.50`. Alan adı `flow` olarak kalır. Sunucu yeniden hesaplamaz, biriktirmez veya sıfırlamaz. Urban ekranında ve Test Oynat'ta **Toplam Flow** olarak gösterilir. Birimi belirtilmediği için arayüze birim eklenmez.
- Ayrı `total_flow` alanı kaldırılmıştır; yeni MQTT paketinin sonunda ve yeni HTTP/CSV şemasında bulunmaz. Anlık akış için ayrı bir Urban alanı yoktur.
- Bataryadaki Wh mevcut `bwh` alanından gelir; yeni alan değildir. SOC ve KE'nin altında iki ondalık basamakla gösterilir.
- Batarya sıcaklığı tek satırdır: `max_temperature`. Tank sıcaklığı `T_tank_C` olarak korunur.
- EYS/Oran/Flow eski pakette yoksa arayüzde `--` gösterilir.
- Kelly yalnızca `error_code` ile doğrudan hata eşleştirmesi yapar; bit maskesi değildir. `errorcode1`, `errorcode2`, `errorcode3` ayrı Araç Kontrol Sistemi kodlarıdır.

## HTTP: GET /data

Kimlik doğrulama `key` query parametresiyle yapılır. Aşağıdaki kısaltmalar yalnızca URL'de kullanılır; sunucu içindeki, SSE'deki ve CSV'deki anahtarlar aynı kalır.

| İç alan / eski HTTP adı | Yeni HTTP adı |
| --- | --- |
| gsmspeed | gs |
| gs | gq |
| fa | fc |
| T_tank_C | tc |
| max_temperature | bmt |
| ischarging | isc |
| charge_voltage | cv |
| charge_current | cc |
| charge_time | ct |
| enable | en |
| fwd_rev | fr |
| throttle | gaz |
| controller_temperature | kct |
| controller_speed | kcs |
| error_code | kec |
| errorcode1 | aec1 |
| errorcode2 | aec2 |
| errorcode3 | aec3 |

Diğer adlar değişmez: `h`, `x`, `y`, `fv`, `fw`, `eysv`, `eysc`, `eysw`, `oran`, `flow`, `fet`, `fit`, `bv`, `bc`, `bw`, `bwh`, `soc`, `ke`, `mv`, `mc`, `mw`, `rpm`. Toplam değer HTTP'de `flow=12.50` olarak gönderilir; `total_flow` gönderilmez.

Önemli: Yeni URL'de **`gs` GPS hızıdır, `gq` GSM sinyalidir**. Eski tam URL'ler de desteklenir: `gsmspeed` varsa o GPS hızı, yanındaki `gs` GSM sinyali olarak okunur. Yeni göndericide eski ve yeni adları karıştırmayın. `gsmspeed` ve `gq` olmadan tek başına `gs` gönderilirse yeni sözleşme gereği GPS hızı sayılır, sinyal boş kalır.

Tam örnek (adres ve anahtar yer tutucudur):

```text
http://SUNUCU:3000/data?key=API_ANAHTARI&h=45.0&gs=44.6&x=41.015100&y=28.979500&gq=23&fv=38.74&fc=10.25&fw=397.09&eysv=52.21&eysc=7.58&eysw=395.75&oran=65.25&flow=12.50&fet=35&fit=60&tc=30.2&bv=52.4&bc=12.3&bw=644.52&bwh=123.45&bmt=41.5&soc=85&ke=39.5&isc=1&cv=54.0&cc=12.0&ct=01%3A20%3A00&mv=50.2&mc=20.1&mw=1009.02&en=1&fr=2&rpm=2400&gaz=45&kct=55&kcs=44.5&kec=0&aec1=0&aec2=0&aec3=0&s=1
```

Ondalık ayracı nokta olmalıdır. `isc=1` şarj oluyor, `isc=0` şarj olmuyor; önceki `charging` / `not_charging` metinleri de desteklenir. `ct` ekranda gösterilecek süredir; örneğin `01:20:00`. URL oluştururken `URLSearchParams` kullanırsanız `:` otomatik `%3A` olur; değeri önce elle kodlayıp sonra bir daha kodlamayın.

```js
const query = new URLSearchParams({
  key: 'API_ANAHTARI',
  // Diğer alanları da ekleyin.
  gs: '44.6', gq: '23', isc: '1', ct: '01:20:00',
});
const url = `http://SUNUCU:3000/data?${query}`;
```

### TÜBİTAK dosyasını HTTP ile başlatma / sürdürme

Her istekte normal telemetri alanları gönderilmeye devam eder; `s` sadece kayıt kontrolüdür:

- `&s=1`: her geldiğinde yeni TÜBİTAK CSV'si açılır. **Aynı isteğin verisi, başlıkla birlikte dosyanın ilk veri satırına yazılır; `zaman_ms=0` olur.** Sonraki paketi beklemez, bu paketi atlamaz.
- `&s=0`: en son açılan dosyaya eklenir. HTTP'de 60 saniyeden uzun veri boşluğu yeni dosya açmaz.
- `s` gönderilmezse `0` gibi devam eder. Henüz dosya yoksa ilk isteğin verisiyle bir dosya oluşturulur. Sunucu yeniden başladıktan sonra `s=0`, diskteki son açılan uygun dosyaya devam eder.
- Her `s=1` ayrı bir başlangıçtır; yeni dosya istemiyorsanız sonraki paketlerde `s=0` gönderin. Aynı saniye/milisaniyedeki başlangıçlar farklı dosya adları alır; eski kayıtlar ezilmez.
- `s`, MQTT'nin 40 alanına veya günlük/test CSV sütunlarına eklenmez. Proto'yu etkilemez. `0`/`1` dışındaki değerler Urban HTTP'de `400 INVALID_S` alır.

Yeni dosya adları başlangıcın milisaniyesini de içerir; gerekirse çakışma sıra numarası eklenir. Kayıt değiştiğinde eski dosyanın bekleyen satırları yine eski dosyaya yazılır. MQTT'nin ilk paket ve 60 saniyelik boşlukta yeni dosya açma davranışı korunur.

## MQTT: 40 alan

Kısa URL adları MQTT alan sırasını değiştirmez. `eysv`, `eysc`, `eysw` doğrudan `fv`, `fa`, `fw` sonrasındadır; `oran`, `flow` da EYS sonrasındadır. `flow` 13. alan olarak toplam akışı taşır; paket `errorcode3` ile biter. Sondaki ayrı `total_flow` kaldırılmıştır. Alanlar `*` ile ayrılır; mevcut `01_` öneki kullanılabilir.

```text
h*gsmspeed*x*y*gs*fv*fa*fw*eysv*eysc*eysw*oran*flow*fet*fit*T_tank_C*bv*bc*bw*bwh*max_temperature*soc*ke*ischarging*charge_voltage*charge_current*charge_time*mv*mc*mw*enable*fwd_rev*rpm*throttle*controller_temperature*controller_speed*error_code*errorcode1*errorcode2*errorcode3
```

Güncel gönderici **40 alan** göndermelidir. Eski 35 alanlı paketler desteklenir; eksik EYS/Oran/Flow boş kalır. Eski 41 alanlı paketler de okuma uyumluluğu için desteklenir: son alandaki `total_flow`, yeni `flow` değerine çevrilir; eski anlık `flow` kullanılmaz. Eski HTTP isteğinde `total_flow` varsa aynı kural geçerlidir. Çıktıda ikinci bir alan tutulmaz. 35, 40 veya 41 alan içermeyen paketler sütun kaymasını önlemek için reddedilir. MQTT'de `charge_time` URL-kodlanmaz; doğrudan `01:20:00` gönderilir.

## CSV ve test oynatma

- Günlük ve test CSV'lerinde `time` sütununun hemen ardından **`interval_ms`** gelir. İki ardışık Urban paketinin sunucuya geliş zamanları arasındaki farktır; araçtan gönderilmez. İlk paket boş, aynı milisaniyedeki iki paket için `0` yazılır. Sunucu yeniden başladığında ilk paket tekrar boştur. Kanal değişimi/veri kesintisi varsa geçen boşluk da farkın içindedir.
- EYS, `oran` ve toplam akışı taşıyan **`flow`** günlük/test kayıtlarına girer. Yeni dosyada ayrı `total_flow` sütunu yoktur; son telemetri sütunu `errorcode3` olur. Günlük CSV 43 sütun (tarih/saat/aralık + 40 alan), test CSV 44 sütundur (ek `test_time`). HTTP kısa adları CSV başlıklarını kısaltmaz.
- `flow` CSV'de `oran` sonrasına araçtan geldiği gibi yazılır. Araç `0` gönderirse `0`, ondalıklı değer gönderirse o değer yazılır; alan gönderilmezse boş kalır. Önceki toplam taşınmaz ve formül uygulanmaz.
- `interval_ms` arayüzde gösterilmez. Toplam `flow` Urban Yakıt Hücresi kutusunda ve Test Oynat'ta **Toplam Flow** olarak görünür; Proto'nun `flow` / `totalflow` alanları ve görünümü korunur.
- Eski CSV dosyaları değiştirilmez. Test Oynat ve toplu CSV/XLSX indirmede eski `total_flow` sütunu varsa toplam değer yeni `flow` alanına eşlenir; eski anlık `flow` orijinal dosyada kalır. Eski toplam boşsa anlık değerle doldurulmaz; `0` geçerli bir toplamdır. Toplu çıktıda ayrı `total_flow` sütunu oluşmaz. Yalnızca `flow` başlığı olan kayıtta mevcut değer aynen kullanılır.
- Aynı günün mevcut CSV başlığı eskiyse dosyaya yeni format eklenmez. Örneğin `28-08-2026_urban_verileri.csv` korunur, yeni kayıt `28-08-2026_v2_urban_verileri.csv` dosyasında devam eder. Eski ve yeni dosyalar günlük kayıt listesinde ayrı bulunur. “Bugün” indirmesi aktif dosyayı, tüm kayıtları indirme ise sütun adlarına göre birleştirilmiş veriyi verir.
- TÜBİTAK'ın altı sütunu: `zaman_ms;hiz_kmh;T_bat_C;T_tank_C;V_bat_C;kalan_enerji_Wh`. `V_bat_C` sütununa yine `bv` batarya voltajı yazılır; yalnızca başlık adı değişmiştir. Eski `V_bat_V` başlıklı dosyalar değiştirilmez ve bu dosyalara yeni kayıt eklenmez; devam etmek için güncel başlıklı uygun dosya yoksa yeni dosya açılır. `bmt` ve `tc` yine doğru batarya/tank sıcaklıklarına eşlenir.

## Test

Sunucuda uygun araç/kanal seçiliyken sahte veri göndermek için:

```sh
npm run urban-http-publisher
# veya
npm run urban-publisher
```

HTTP publisher varsayılan olarak yerel `http://127.0.0.1:3000/data` adresine gönderir. İlk başarılı istekte `s=1`, sonraki isteklerde `s=0` gönderir. `URBAN_HTTP_URL`, `TELEMETRY_API_KEY`, `SEND_INTERVAL` ortam değişkenleri desteklenir. MQTT publisher proje yapılandırmasındaki brokera gönderir; çalışan araçla aynı anda sahte veri göndermeyin.

Gerçek brokera veya kayıt dizinlerine dokunmayan otomatik testler:

```sh
npm run test:urban
```

Arayüz testleri için `telemetriV2` bağımlılıkları da kurulmuş olmalıdır. Testler HTTP/MQTT eşliğini, eski paketleri, Proto sözleşmesini, gerçek geçici CSV kayıtlarını, test oynatmayı ve EYS değiştiğinde Fuel Cell ibresinin değişmediğini denetler.

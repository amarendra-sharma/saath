"""Builds public/guide.html (English) and public/guide.<lang>.html from guide/body.<lang>.html.
Each body file holds everything from the skip link to the footer, already translated, with {{LANGS}} where the
language switcher goes. Head (styles) and tail (scripts) are shared, so a design change is made once."""
import sys, re, pathlib

here = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1])  # the app's public/ folder
LANGS = [  # code, native name, page title, description
    ("en", "English", "Bengu user guide", "How to use Bengu: circles, shares, bills, paying your share, the money trail, Bill Check, reminders, insights, agreements and Bengu Plus."),
    ("hi", "हिन्दी", "Bengu उपयोग गाइड", "Bengu कैसे इस्तेमाल करें: समूह, हिस्से, बिल, अपना हिस्सा भेजना, पैसे का हिसाब, बिल जाँच, अनुस्मारक, इनसाइट्स, समझौते और Bengu Plus।"),
    ("bn", "বাংলা", "Bengu ব্যবহারের গাইড", "Bengu কীভাবে ব্যবহার করবেন: দল, অংশ, বিল, নিজের অংশ দেওয়া, টাকার হিসাব, বিল যাচাই, অনুস্মারক, ইনসাইটস, চুক্তি ও Bengu Plus।"),
    ("ne", "नेपाली", "Bengu प्रयोग निर्देशिका", "Bengu कसरी प्रयोग गर्ने: समूह, हिस्सा, बिल, आफ्नो हिस्सा तिर्ने, पैसाको हिसाब-किताब, बिल जाँच, रिमाइन्डर, विश्लेषण, सम्झौता र Bengu Plus।"),
    ("es", "Español", "Guía de Bengu", "Cómo usar Bengu: círculos, partes, facturas, pagar tu parte, el rastro del dinero, la revisión de facturas, recordatorios, estadísticas, acuerdos y Bengu Plus."),
    ("fr", "Français", "Guide de Bengu", "Comment utiliser Bengu : cercles, parts, factures, payer sa part, le suivi de l'argent, la vérification des factures, les rappels, les statistiques, les accords et Bengu Plus."),
    ("pt", "Português", "Guia do Bengu", "Como usar o Bengu: círculos, partes, contas, pagar sua parte, o rastro do dinheiro, a verificação de contas, lembretes, estatísticas, acordos e Bengu Plus."),
]
page = lambda c: "guide.html" if c == "en" else f"guide.{c}.html"

head = (here / "head.html").read_text(encoding="utf-8")
tail = (here / "tail.html").read_text(encoding="utf-8")
css = """  nav.top .langs { position:relative; }
  nav.top .langs select { font:inherit; font-size:14px; font-weight:600; color:var(--ink2); background:var(--card); border:1px solid var(--line); border-radius:10px; padding:6px 8px; }
  nav.top .links .btn { white-space:nowrap; }
  @media (max-width:560px) { nav.top .links > a:not(.btn) { display:none; } nav.top .brand { font-size:0; gap:0; } nav.top .links { gap:8px; } nav.top .links .btn { padding:8px 12px; font-size:14px; } }
</style>"""
alts = "\n".join(f'<link rel="alternate" hreflang="{c}" href="https://bengu.macronations.com/{page(c)}">' for c, *_ in LANGS)

for code, native, title, desc in LANGS:
    body = (here / f"body.{code}.html").read_text(encoding="utf-8")
    opts = "".join(f'<option value="/{page(c)}"{" selected" if c == code else ""} lang="{c}">{n}</option>' for c, n, *_ in LANGS)
    switch = (f'<span class="langs"><label for="lang" style="position:absolute;left:-999px">Language</label>'
              f'<select id="lang" onchange="location.href=this.value+location.hash">{opts}</select></span>')
    assert "{{LANGS}}" in body, code
    h = head.replace('<html lang="en">', f'<html lang="{code}">', 1)
    h = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", h, count=1)
    h = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', h, count=1)
    h = h.replace("</style>", css, 1).replace("</head>", alts + "\n</head>", 1)
    (out / page(code)).write_text(h + "\n<body>\n" + body.replace("{{LANGS}}", switch) + "\n" + tail + "\n", encoding="utf-8")
    print("wrote", page(code))

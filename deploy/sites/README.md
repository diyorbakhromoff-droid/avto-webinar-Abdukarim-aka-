# Boshqa loyihalarning saytlari

Shu serverda Avtowebinar Caddy'si orqali boshqa loyiha ham ochilsa (masalan, zikr-marafoni), uning sayt blokini
`deploy/Caddyfile` ga emas, shu papkaga alohida fayl qilib yozing: `deploy/sites/<loyiha>.caddy`.

```
zikrmarafon.duckdns.org {
	encode gzip
	reverse_proxy zikr-marafoni-api:8000
}
```

Bu fayllar gitga kirmaydi (`.gitignore`), shuning uchun `git pull` bilan to'qnashmaydi. O'zgartirgandan keyin:
`docker compose restart web`.

Muhim: boshqa loyihaning konteyneri `avtowebinar_default` tarmog'iga ulansa, uning servis nomlari (`api`, `redis` ...)
bizning servislar bilan bir xil bo'lishi mumkin. Shuning uchun Avtowebinar o'z servislariga faqat
`avtowebinar-api`, `avtowebinar-postgres`, `avtowebinar-redis` nomlari bilan murojaat qiladi.

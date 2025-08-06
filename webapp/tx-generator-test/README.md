# Cosmos Token Transfer with Mina Signatures (TypeScript)

Bu proje, Cosmos chain üzerinde Mina private key ile imzalanmış token transfer transaction'ları oluşturmak için tasarlanmıştır.

**🎉 Artık hiçbir private key girmeye gerek yok! Tüm key'ler otomatik generate ediliyor.**
**🔥 REAL Mina key'leri o1js ile oluşturuluyor - artık mock değil!**

## Kurulum

1. Gerekli paketleri yükleyin:
```bash
npm install
```

2. TypeScript support için:
```bash
# Eğer tsx global değilse
npm install -g tsx

# Veya npx ile kullanın
```

## Kullanım

### Zero Configuration! 🚀

Artık **hiçbir environment variable** ayarlamanıza gerek yok! Program her çalıştığında:
- ✨ Fresh Cosmos keypair oluşturur 
- ✨ **REAL** Mina keypair oluşturur (o1js ile)
- ✨ **GERÇEK** Mina signature oluşturur
- ✨ Broadcast komutu verir

### Opsiyonel Customization

İsterseniz bu parametreleri özelleştirebilirsiniz:

```bash
# Opsiyonel - sadece customization için:
export TO_ADDRESS="consumer1abc..."                # Default: consumer1xxx...
export AMOUNT="5000000"                           # Default: 1000000 (1 token)  
export CHAIN_ID="your-chain"                      # Default: pulsar-devnet
export RPC="http://your-node:26657"               # Default: http://localhost:26657
```

### Çalıştırma

```bash
# TypeScript ile doğrudan çalıştırma
npm start

# Veya geliştirme modu (watch)
npm run dev

# Manuel tsx ile
npx tsx index.ts
```

**Bu kadar! Hiçbir key girmeye gerek yok.** 🎯

## Nasıl Çalışır?

1. **Fresh Keys**: Her çalıştırmada fresh Cosmos ve **REAL** Mina keypair'leri oluşturur (o1js)
2. **Transaction Building**: MsgSend mesajı oluşturur
3. **Extension Adding**: TxTypeExtension eklenir (MINA_TX = 1)
4. **Real Mina Signing**: **Gerçek** o1js ile oluşturulan Mina key ile imzalar
5. **Output**: Base64 encoded transaction ve broadcast komutu verir

## TypeScript Notları

- Kod TypeScript ile yazılmıştır ve `tsx` ile çalıştırılır
- Tüm type'lar belirtilmiştir
- Async/await pattern kullanılmıştır
- **o1js** kullanarak gerçek Mina cryptography

## Dependencies

- `@cosmjs/*` - Cosmos SDK JavaScript kütüphaneleri
- `o1js` - **REAL** Mina key generation ve signatures
- `cosmjs-types` - Cosmos protobuf type'ları
- `tsx` - TypeScript execution
- `@types/node` - Node.js type definitions

## Önemli Notlar

- 🎲 **Tam otomatik!** Hiçbir private key girmene gerek yok
- ✨ **Fresh keypairs** her çalıştırmada yeni oluşturuluyor
- 🔥 **REAL Mina keys** o1js ile oluşturuluyor (artık mock değil!)
- 🔐 **Gerçek imzalama** o1js Signature.create() ile yapılıyor
- 🏠 **Cosmos identity** sadece AuthInfo için kullanılıyor
- 🔗 Chain'in Mina signature verification desteği olması gerekir (custom ante handler)
- 🛠️ Bu kod framework-agnostic'tir, CosmJS'in otomatik imzalanmasını kullanmaz

## Örnek Output

```
🔄 Starting transaction generator...
🎲 Generating fresh keypairs...

🔑 Generating random Cosmos keypair for identity...
🔐 Generating REAL Mina keypair using o1js...
✅ Generated Cosmos address: consumer1957762u4kl0lyte4e5djt9ykpe97tn6vscqplw
✅ Generated Mina pubkey: B62qiy32p8kAKnny8ZFwoMhYpBppM1DWVCqAPBYNcXnsAHhnfAAuXgg
✅ Generated Mina privkey: EKF8VVQFSFhXQJFACTUdvx4zx5RJtfUKAfMoprBCEaHjHaAcJtTd

✍️  Signing transaction with REAL Mina private key (o1js)...
🔐 Real Mina signature created!
   - Field (r): 0x1a2b3c4d...
   - Scalar (s): 0x5e6f7890...

============================================================
🎯 TRANSACTION GENERATED SUCCESSFULLY
============================================================
🔑 Generated Mina pubkey    : B62qiy32p8kAKnny8ZFwoMhYpBppM1DWVCqAPBYNcXnsAHhnfAAuXgg
🔐 Generated Mina privkey   : EKF8VVQFSFhXQJFACTUdvx4zx5RJtfUKAfMoprBCEaHjHaAcJtTd
🏠 Generated Cosmos identity: consumer1957762u4kl0lyte4e5djt9ykpe97tn6vscqplw
📤 Sending to               : consumer1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
💰 Amount                   : 1000000 stake
⛽ Fee                      : 5000 stake
🔗 Chain ID                 : pulsar-devnet
============================================================
📦 Tx (base64)              : CogBCiMKH...
============================================================

🚀 Broadcast with:
curl -X POST http://localhost:26657/broadcast_tx_commit -d '{"tx":"CogBCiMKH..."}'

💡 Note: Using REAL Mina keys generated with o1js!
🔄 Both Cosmos and Mina keypairs are fresh and authentic!
```

## Avantajlar

✅ **Sıfır konfigürasyon**: Hiçbir key girmeye gerek yok  
✅ **GERÇEK Mina keys**: o1js ile authentic key generation  
✅ **Tam güvenli**: Her çalıştırmada fresh key'ler  
✅ **Kolay kullanım**: `npm start` yeterli  
✅ **Temiz**: Hiçbir hassas bilgi saklanmıyor  
✅ **Esnek**: Transaction parametreleri hâlâ ayarlanabilir  
✅ **Production-ready crypto**: Real o1js signatures

## o1js Integration

Bu projenin en önemli özelliği **gerçek o1js** kullanması:

- `PrivateKey.random()` - Cryptographically secure private key
- `privateKey.toPublicKey()` - Proper public key derivation  
- `Signature.create()` - Real Mina signature generation
- `Field()` - Proper field arithmetic for hash conversion

Artık **mock signature'lar yok**, her şey gerçek Mina cryptography!

## Demo Purpose

Bu kod **demo/test** amaçlı tasarlanmıştır. Production kullanım için:
- Key management sistemleri kullanın
- Güvenli key storage implementasyonu ekleyin  
- Account sequence ve balance kontrolü yapın
- Real RPC query functionality ekleyin

## Troubleshooting

Eğer TypeScript hataları alıyorsanız:

1. `@types/node` paketinin yüklendiğinden emin olun:
   ```bash
   npm install --save-dev @types/node
   ```

2. `tsconfig.json` dosyası oluşturun:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "node",
       "esModuleInterop": true,
       "allowSyntheticDefaultImports": true,
       "strict": true,
       "skipLibCheck": true,
       "types": ["node"]
     }
   }
   ```

## Security

- ✅ **Hiçbir private key depolanmıyor**: Her çalıştırmada fresh
- ✅ **Zero configuration**: Hassas bilgi girme riski yok
- ✅ **Real cryptography**: o1js ile authentic Mina keys
- ✅ **Production-grade**: Real signature generation
- ✅ **Self-contained**: Dış bağımlılık yok 
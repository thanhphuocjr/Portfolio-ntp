# Portfolio

Bạn chỉ cần đụng vào hai chỗ:

- **`noi-dung.txt`**: toàn bộ chữ trên website. Hướng dẫn điền nằm ngay đầu file.
- **`media/`**: ảnh và CV. Danh sách tên file và kích thước cũng nằm đầu `noi-dung.txt`.

## Chạy thử

```bash
npm install     # chỉ cần lần đầu
npm run dev     # mở http://localhost:4321
```

Lưu `noi-dung.txt` hoặc thêm ảnh vào `media/` là trang tự tải lại, không cần khởi động lại.

Khi chạy thử, ô chưa điền hiện chữ gợi ý có gạch chân đứt nét, ảnh chưa có hiện đường dẫn cần đặt file, và góc dưới bên trái có danh sách những mục còn thiếu. Những thứ này không xuất hiện trên website thật.

## Đưa lên mạng

```bash
npm run build     # tạo website trong thư mục dist/, đồng thời liệt kê mục còn thiếu
npm run preview   # xem trước đúng bản sẽ đưa lên mạng
```

Thư mục `dist/` là website tĩnh, đưa lên đâu cũng được. Cách nhanh nhất là Vercel hoặc Netlify:

- **Vercel:** chạy `npx vercel` trong thư mục dự án, hoặc kết nối repo GitHub.
- **Netlify:** kéo thả thư mục `dist/` vào [app.netlify.com/drop](https://app.netlify.com/drop).

Sau khi có địa chỉ, điền nó vào ô `website` trong `noi-dung.txt` rồi build lại, để ảnh xem trước hiện ra khi chia sẻ link.

Nếu đưa lên GitHub Pages dưới dạng `ten.github.io/ten-repo`, cần thêm `base: '/ten-repo'` vào `astro.config.mjs`. Dùng tên miền riêng hoặc `ten.github.io` thì không cần.

Nên tắt `npm run dev` trước khi chạy `npm run build`: chạy song song có thể làm trang dev mất hiệu ứng cho tới khi khởi động lại.

## Nhận lời nhắn qua email

Website tĩnh không tự gửi được email, nên form dùng dịch vụ [Web3Forms](https://web3forms.com):

1. Vào [web3forms.com/#start](https://web3forms.com/#start) và nhập email muốn nhận lời nhắn.
2. Copy Access Key trong email họ gửi, dán vào ô `khoa_form` trong `noi-dung.txt`.
3. Gửi thử một lời nhắn trên website sau khi đưa lên mạng.

Khoá này được phép công khai. Email nhận được có sẵn địa chỉ người gửi, chỉ cần bấm Reply. Nếu để trống ô này, form sẽ mở ứng dụng mail của người xem.

## Đổi màu

Sửa `--lo`, `--mid`, `--hi`, `--accent` ở đầu `src/styles/global.css`, và đổi giá trị tương ứng trong `RAMP` ở `src/scripts/field.ts` (màu của đám hạt, viết theo thang 0–1).

## Công nghệ

Astro 5, GSAP và Lenis cho chuyển động, WebGL2 viết tay cho đám hạt (không dùng thư viện 3D), font tự host có đủ dấu tiếng Việt. Dự án dùng Astro 5 vì Astro 6 trở lên cần Node 22, trong khi máy này đang chạy Node 20.
# Portfolio-ntp

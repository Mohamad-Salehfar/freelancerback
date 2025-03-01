const Controller = require("./controller");
const {
  generateRandomNumber,
  toPersianDigits,
  setAccessToken,
  setRefreshToken,
  verifyRefreshToken,
} = require("../../../utils/functions");
const createError = require("http-errors");
const { UserModel } = require("../../models/user");
const Kavenegar = require("kavenegar");
const CODE_EXPIRES = 90 * 1000; //90 seconds in miliseconds
const { StatusCodes: HttpStatus } = require("http-status-codes");
const {
  completeProfileSchema,
  updateProfileSchema,
  checkOtpSchema,
} = require("../validators/user.schema");
const { Resend } = require("resend");

class userAuthController extends Controller {
  constructor() {
    super();
    this.code = 0;
    this.email = null;
  }
  async getOtp(req, res) {
    let { email } = req.body;

    if (!email) throw createError.BadRequest("شماره موبایل معتبر را وارد کنید");

    email = email.trim();
    this.email = email;
    this.code = generateRandomNumber(6);

    const result = await this.saveUser(email);
    if (!result) throw createError.Unauthorized("ورود شما انجام نشد.");

    // send OTP

    this.sendOTP(email, res);
  }
  async checkOtp(req, res) {
    await checkOtpSchema.validateAsync(req.body);
    const { otp: code, email } = req.body;

    const user = await UserModel.findOne(
      { email },
      { password: 0, refreshToken: 0, accessToken: 0 }
    );

    if (!user) throw createError.NotFound("کاربری با این مشخصات یافت نشد");

    if (user.otp.code != code)
      throw createError.BadRequest("کد ارسال شده صحیح نمیباشد");

    if (new Date(`${user.otp.expiresIn}`).getTime() < Date.now())
      throw createError.BadRequest("کد اعتبار سنجی منقضی شده است");

    user.isVerifiedPhoneNumber = true;
    await user.save();

    // await setAuthCookie(res, user); // set httpOnly cookie
    await setAccessToken(res, user);
    await setRefreshToken(res, user);
    let WELLCOME_MESSAGE = `کد تایید شد، به فرانت هوکس خوش آمدید`;
    if (!user.isActive)
      WELLCOME_MESSAGE = `کد تایید شد، لطفا اطلاعات خود را تکمیل کنید`;

    return res.status(HttpStatus.OK).json({
      statusCode: HttpStatus.OK,
      data: {
        message: WELLCOME_MESSAGE,
        user,
      },
    });
  }
  async saveUser(email) {
    const otp = {
      code: this.code,
      expiresIn: Date.now() + CODE_EXPIRES,
    };

    const user = await this.checkUserExist(email);
    if (user) return await this.updateUser(email, { otp });

    return await UserModel.create({
      email,
      otp,
      // role: ROLES.USER,
    });
  }
  async checkUserExist(email) {
    const user = await UserModel.findOne({ email });
    return user;
  }
  async updateUser(email, objectData = {}) {
    Object.keys(objectData).forEach((key) => {
      if (["", " ", 0, null, undefined, "0", NaN].includes(objectData[key]))
        delete objectData[key];
    });
    const updatedResult = await UserModel.updateOne(
      { email },
      { $set: objectData }
    );
    return !!updatedResult.modifiedCount;
  }
  async sendOTP(email, res) {
    // const kaveNegarApi = Kavenegar.KavenegarApi({
    //   apikey: `${process.env.KAVENEGAR_API_KEY}`,
    // });
    // kaveNegarApi.VerifyLookup(
    //   {
    //     receptor: phoneNumber,
    //     token: this.code,
    //     template: "registerVerify",
    //   },
    //   (response, status) => {
    //     console.log(response);
    //     console.log("kavenegar message status", status);
    //     if (response && status === 200)
    //       return res.status(HttpStatus.OK).send({
    //         statusCode: HttpStatus.OK,
    //         data: {
    //           message: `کد تائید برای شماره موبایل ${toPersianDigits(
    //             phoneNumber
    //           )} ارسال گردید`,
    //           expiresIn: CODE_EXPIRES,
    //           phoneNumber,
    //         },
    //       });

    //     return res.status(status).send({
    //       statusCode: status,
    //       message: "کد اعتبارسنجی ارسال نشد",
    //     });
    //   }
    // );

    const resend = new Resend("re_RSYiPt16_QGjKhQdPpmZ2gCggGKJK4WLh"); // ای پی ای کی خودت رو بذار

    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "mmad.sd1998@gmail.com", // ایمیلی که ثبت نام کردی وارد کن
      subject: "کد اعتبار سنجی",
      html: `<p>${this.code}</p>`,
    });

    res.status(200).json({ message: "کد اعتبار سنجی ارسال شد" });
  }
  async completeProfile(req, res) {
    await completeProfileSchema.validateAsync(req.body);
    const { user } = req;
    const { name, email, role } = req.body;

    if (!user.isVerifiedPhoneNumber)
      throw createError.Forbidden("شماره موبایل خود را تایید کنید.");

    const duplicateUser = await UserModel.findOne({ email });
    console.log(duplicateUser);
    if (duplicateUser)
      throw createError.BadRequest(
        "کاربری با این ایمیل قبلا ثبت نام کرده است."
      );

    const updatedUser = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: { name, email, isActive: true, role } },
      { new: true }
    );
    // await setAuthCookie(res, updatedUser);
    await setAccessToken(res, updatedUser);
    await setRefreshToken(res, updatedUser);

    return res.status(HttpStatus.OK).send({
      statusCode: HttpStatus.OK,
      data: {
        message: "اطلاعات شما با موفقیت تکمیل شد",
        user: updatedUser,
      },
    });
  }
  async updateProfile(req, res) {
    const { _id: userId } = req.user;
    await updateProfileSchema.validateAsync(req.body);
    const { name, email, biography } = req.body;

    const updateResult = await UserModel.updateOne(
      { _id: userId },
      {
        $set: { name, email, biography },
      }
    );
    if (!updateResult.modifiedCount === 0)
      throw createError.BadRequest("اطلاعات ویرایش نشد");
    return res.status(HttpStatus.OK).json({
      statusCode: HttpStatus.OK,
      data: {
        message: "اطلاعات با موفقیت آپدیت شد",
      },
    });
  }
  async refreshToken(req, res) {
    const userId = await verifyRefreshToken(req);
    const user = await UserModel.findById(userId);
    await setAccessToken(res, user);
    await setRefreshToken(res, user);
    return res.status(HttpStatus.OK).json({
      StatusCode: HttpStatus.OK,
      data: {
        user,
      },
    });
  }
  async getUserProfile(req, res) {
    const { _id: userId } = req.user;
    const user = await UserModel.findById(userId, { otp: 0 });

    return res.status(HttpStatus.OK).json({
      statusCode: HttpStatus.OK,
      data: {
        user,
      },
    });
  }
  logout(req, res) {
    const cookieOptions = {
      maxAge: 1,
      expires: Date.now(),
      httpOnly: true,
      signed: true,
      sameSite: "Lax",
      secure: true,
      path: "/",
      domain: process.env.DOMAIN,
    };
    res.cookie("accessToken", null, cookieOptions);
    res.cookie("refreshToken", null, cookieOptions);

    return res.status(HttpStatus.OK).json({
      StatusCode: HttpStatus.OK,
      roles: null,
      auth: false,
    });
  }
}

module.exports = {
  UserAuthController: new userAuthController(),
};
